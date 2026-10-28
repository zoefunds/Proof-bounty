// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title ProofBountyEscrow
/// @notice Base payment layer for ProofBounty. GenLayer adjudicates; this
/// contract holds Base Sepolia USDC and executes a decision exactly once.
/// A relay transaction needs both the relayer account and an independent
/// EIP-712 decision-signer authorization bound to this chain and contract.
contract ProofBountyEscrow {
    enum Outcome { None, Winner, BondRefund, BondForfeit, BountyRefund }

    struct Bounty {
        address creator;
        uint256 reward;
        uint256 requiredBond;
        uint16 feeBps;
        uint64 fundedAt;
        address genlayerContract;
        bool registered;
        bool rewardSettled;
        uint256 decisionNonce;
    }

    struct PendingAttempt {
        address challenger;
        uint256 bond;
        uint64 fundedAt;
        uint64 authorizationExpiry;
        bool bound;
        bool recovered;
    }

    struct Attempt {
        address challenger;
        uint256 bond;
        uint256 appealBond;
        address appealPayer;
        bool settled;
        uint256 reservationId;
    }

    IERC20 public immutable usdc;
    address public owner;
    address public relayer;
    address public decisionSigner;
    address public treasury;
    bool private locked;

    uint256 public constant BPS = 10_000;
    uint256 public constant ORPHAN_DELAY = 7 days;
    uint256 public constant PENDING_ATTEMPT_RECOVERY_DELAY = 1 days;
    uint256 private constant SECP256K1_HALF_ORDER =
        0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;
    bytes32 private constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 private constant REGISTER_TYPEHASH = keccak256(
        "Register(uint256 bountyId,address creator,uint256 reward,uint256 requiredBond,uint16 feeBps,address genlayerContract)"
    );
    bytes32 private constant FUND_BOUNTY_TYPEHASH = keccak256(
        "FundBounty(uint256 bountyId,address creator,uint256 reward,uint256 requiredBond,uint16 feeBps,address genlayerContract,uint64 authorizationExpiry)"
    );
    bytes32 private constant SETTLE_TYPEHASH = keccak256(
        "Settle(uint256 bountyId,uint256 attemptIndex,uint8 outcome,uint16 payoutBps,address recipient,address appealRecipient,bytes32 genlayerStateHash,uint256 decisionNonce,uint64 validAfter,uint64 validBefore)"
    );
    bytes32 private constant FUND_ATTEMPT_TYPEHASH = keccak256(
        "FundAttempt(uint256 bountyId,uint256 reservationId,address challenger,uint256 bond,address genlayerContract,uint64 authorizationExpiry)"
    );
    bytes32 private constant BIND_ATTEMPT_TYPEHASH = keccak256(
        "BindAttempt(uint256 bountyId,uint256 reservationId,uint256 attemptIndex,address challenger,bytes32 baseFundingTxHash)"
    );
    bytes32 private constant FUND_APPEAL_TYPEHASH = keccak256(
        "FundAppeal(uint256 bountyId,uint256 attemptIndex,address appellant,uint256 bond,address genlayerContract,uint64 authorizationExpiry)"
    );

    mapping(uint256 => Bounty) public bounties;
    mapping(uint256 => mapping(uint256 => PendingAttempt)) public pendingAttempts;
    mapping(uint256 => mapping(uint256 => Attempt)) public attempts;
    mapping(address => uint256) public claimable;
    mapping(bytes32 => bool) public consumedDecisions;

    event BountyFunded(uint256 indexed bountyId, address indexed creator, uint256 reward, uint256 requiredBond);
    event BountyRegistered(uint256 indexed bountyId, address indexed genlayerContract);
    event AttemptFunded(uint256 indexed bountyId, uint256 indexed attemptIndex, address indexed challenger, uint256 bond);
    event AttemptFundingReserved(uint256 indexed bountyId, uint256 indexed reservationId, address indexed challenger, uint256 bond, uint64 authorizationExpiry);
    event AttemptBound(uint256 indexed bountyId, uint256 indexed reservationId, uint256 indexed attemptIndex, address challenger, bytes32 baseFundingTxHash);
    event PendingAttemptRecovered(uint256 indexed bountyId, uint256 indexed reservationId, address indexed challenger, uint256 amount);
    event AppealFunded(uint256 indexed bountyId, uint256 indexed attemptIndex, address indexed appellant, uint256 bond);
    event DecisionExecuted(uint256 indexed bountyId, uint256 indexed attemptIndex, Outcome outcome, bytes32 decisionHash);
    event Claimed(address indexed account, uint256 amount);
    event OrphanRecovered(uint256 indexed bountyId, address indexed creator, uint256 amount);
    event RelayerUpdated(address indexed relayer);
    event DecisionSignerUpdated(address indexed signer);
    event TreasuryUpdated(address indexed treasury);
    event OwnershipTransferred(address indexed owner);

    modifier onlyOwner() { require(msg.sender == owner, "ProofBounty: not owner"); _; }
    modifier onlyRelayer() { require(msg.sender == relayer, "ProofBounty: not relayer"); _; }
    modifier nonReentrant() {
        require(!locked, "ProofBounty: reentrant");
        locked = true;
        _;
        locked = false;
    }

    constructor(address usdc_, address relayer_, address decisionSigner_, address treasury_) {
        require(usdc_ != address(0) && relayer_ != address(0), "ProofBounty: zero address");
        require(decisionSigner_ != address(0) && treasury_ != address(0), "ProofBounty: zero address");
        usdc = IERC20(usdc_);
        owner = msg.sender;
        relayer = relayer_;
        decisionSigner = decisionSigner_;
        treasury = treasury_;
    }

    /// Fund only after the authorization service has verified the finalized
    /// GenLayer creator and exact terms. This prevents predictable-ID squats.
    function fundBounty(
        uint256 bountyId,
        uint256 reward,
        uint256 requiredBond,
        uint16 feeBps,
        address genlayerContract,
        uint64 authorizationExpiry,
        bytes calldata authorization
    ) external nonReentrant {
        require(reward > 0 && feeBps <= 1_000, "ProofBounty: invalid bounty");
        require(genlayerContract != address(0), "ProofBounty: zero GenLayer contract");
        require(block.timestamp <= authorizationExpiry, "ProofBounty: bounty authorization expired");
        Bounty storage b = bounties[bountyId];
        require(b.creator == address(0), "ProofBounty: already funded");
        bytes32 instruction = keccak256(abi.encode(
            FUND_BOUNTY_TYPEHASH, bountyId, msg.sender, reward, requiredBond,
            feeBps, genlayerContract, authorizationExpiry
        ));
        require(_isAuthorized(instruction, authorization), "ProofBounty: bad bounty authorization");
        require(usdc.transferFrom(msg.sender, address(this), reward), "ProofBounty: transferFrom failed");
        b.creator = msg.sender;
        b.reward = reward;
        b.requiredBond = requiredBond;
        b.feeBps = feeBps;
        b.fundedAt = uint64(block.timestamp);
        b.genlayerContract = genlayerContract;
        emit BountyFunded(bountyId, msg.sender, reward, requiredBond);
    }

    function registerBounty(uint256 bountyId, address genlayerContract, bytes calldata authorization) external onlyRelayer {
        Bounty storage b = bounties[bountyId];
        require(b.creator != address(0) && !b.registered && !b.rewardSettled, "ProofBounty: registration unavailable");
        require(genlayerContract == b.genlayerContract, "ProofBounty: GenLayer contract mismatch");
        bytes32 instruction = keccak256(abi.encode(
            REGISTER_TYPEHASH, bountyId, b.creator, b.reward, b.requiredBond, b.feeBps, genlayerContract
        ));
        require(_isAuthorized(instruction, authorization), "ProofBounty: bad authorization");
        b.registered = true;
        emit BountyRegistered(bountyId, genlayerContract);
    }

    /// Fund a GenLayer reservation. The independent decision signer must
    /// authorize the exact challenger, reservation, terms, and expiry, so a
    /// third party cannot squat a future attempt index.
    function fundAttempt(
        uint256 bountyId,
        uint256 reservationId,
        uint64 authorizationExpiry,
        bytes calldata authorization
    ) external nonReentrant {
        Bounty storage b = bounties[bountyId];
        require(b.registered && !b.rewardSettled, "ProofBounty: bounty unavailable");
        require(block.timestamp <= authorizationExpiry, "ProofBounty: funding authorization expired");
        PendingAttempt storage p = pendingAttempts[bountyId][reservationId];
        require(p.challenger == address(0), "ProofBounty: reservation funded");
        bytes32 instruction = keccak256(abi.encode(
            FUND_ATTEMPT_TYPEHASH, bountyId, reservationId, msg.sender,
            b.requiredBond, b.genlayerContract, authorizationExpiry
        ));
        require(_isAuthorized(instruction, authorization), "ProofBounty: bad funding authorization");
        if (b.requiredBond > 0) {
            require(usdc.transferFrom(msg.sender, address(this), b.requiredBond), "ProofBounty: transferFrom failed");
        }
        p.challenger = msg.sender;
        p.bond = b.requiredBond;
        p.fundedAt = uint64(block.timestamp);
        p.authorizationExpiry = authorizationExpiry;
        emit AttemptFundingReserved(bountyId, reservationId, msg.sender, b.requiredBond, authorizationExpiry);
    }

    /// Bind a funded reservation to the exact finalized GenLayer attempt.
    /// The relay submits and the independent signer authorizes the observed
    /// Base funding transaction hash and challenger identity.
    function bindAttempt(
        uint256 bountyId,
        uint256 reservationId,
        uint256 attemptIndex,
        bytes32 baseFundingTxHash,
        bytes calldata authorization
    ) external onlyRelayer {
        require(baseFundingTxHash != bytes32(0), "ProofBounty: missing funding tx");
        Bounty storage b = bounties[bountyId];
        PendingAttempt storage p = pendingAttempts[bountyId][reservationId];
        Attempt storage a = attempts[bountyId][attemptIndex];
        require(b.registered && !b.rewardSettled, "ProofBounty: bounty unavailable");
        require(p.challenger != address(0) && !p.bound, "ProofBounty: reservation unavailable");
        require(a.challenger == address(0), "ProofBounty: attempt already bound");
        bytes32 instruction = keccak256(abi.encode(
            BIND_ATTEMPT_TYPEHASH, bountyId, reservationId, attemptIndex, p.challenger, baseFundingTxHash
        ));
        require(_isAuthorized(instruction, authorization), "ProofBounty: bad bind authorization");
        p.bound = true;
        a.challenger = p.challenger;
        // Recovery compensates the challenger when attestation succeeded but
        // binding was unavailable. A later reconciliation remains bindable,
        // but the already-refunded bond can never be paid a second time.
        a.bond = p.bond;
        a.reservationId = reservationId;
        emit AttemptBound(bountyId, reservationId, attemptIndex, p.challenger, baseFundingTxHash);
        emit AttemptFunded(bountyId, attemptIndex, p.challenger, p.bond);
    }

    /// If the relay/attestor is unavailable, an unbound reservation becomes
    /// recoverable by its challenger without any privileged signature.
    function recoverPendingAttempt(uint256 bountyId, uint256 reservationId) external nonReentrant {
        PendingAttempt storage p = pendingAttempts[bountyId][reservationId];
        require(msg.sender == p.challenger && !p.bound && !p.recovered, "ProofBounty: recovery unavailable");
        require(block.timestamp >= uint256(p.authorizationExpiry) + PENDING_ATTEMPT_RECOVERY_DELAY, "ProofBounty: recovery delay");
        p.recovered = true;
        uint256 amount = p.bond;
        p.bond = 0;
        claimable[msg.sender] += amount;
        emit PendingAttemptRecovered(bountyId, reservationId, msg.sender, amount);
    }

    function fundAppeal(
        uint256 bountyId,
        uint256 attemptIndex,
        uint64 authorizationExpiry,
        bytes calldata authorization
    ) external nonReentrant {
        Bounty storage b = bounties[bountyId];
        Attempt storage a = attempts[bountyId][attemptIndex];
        require(b.registered && !a.settled && a.challenger != address(0), "ProofBounty: appeal unavailable");
        require(a.appealBond == 0 && b.requiredBond > 0, "ProofBounty: appeal bond unavailable");
        require(block.timestamp <= authorizationExpiry, "ProofBounty: appeal authorization expired");
        bytes32 instruction = keccak256(abi.encode(
            FUND_APPEAL_TYPEHASH, bountyId, attemptIndex, msg.sender,
            b.requiredBond, b.genlayerContract, authorizationExpiry
        ));
        require(_isAuthorized(instruction, authorization), "ProofBounty: bad appeal authorization");
        require(usdc.transferFrom(msg.sender, address(this), b.requiredBond), "ProofBounty: transferFrom failed");
        a.appealBond = b.requiredBond;
        a.appealPayer = msg.sender;
        emit AppealFunded(bountyId, attemptIndex, msg.sender, b.requiredBond);
    }

    /// Winner settles the reward and its bond. BondRefund/BondForfeit settle
    /// one attempt only. BountyRefund returns the still-unsettled reward.
    function executeDecision(
        uint256 bountyId,
        uint256 attemptIndex,
        uint8 outcomeCode,
        uint16 payoutBps,
        address recipient,
        address appealRecipient,
        bytes32 genlayerStateHash,
        uint256 decisionNonce,
        uint64 validAfter,
        uint64 validBefore,
        bytes calldata authorization
    ) external onlyRelayer {
        require(outcomeCode >= uint8(Outcome.Winner) && outcomeCode <= uint8(Outcome.BountyRefund), "ProofBounty: bad outcome");
        require(genlayerStateHash != bytes32(0) && !consumedDecisions[genlayerStateHash], "ProofBounty: decision consumed");
        require(recipient != address(0) && payoutBps <= BPS, "ProofBounty: bad instruction");
        require(validAfter <= block.timestamp && block.timestamp <= validBefore, "ProofBounty: decision outside validity window");
        Bounty storage b = bounties[bountyId];
        require(decisionNonce == b.decisionNonce + 1, "ProofBounty: stale decision nonce");
        bytes32 instruction = keccak256(abi.encode(
            SETTLE_TYPEHASH, bountyId, attemptIndex, outcomeCode, payoutBps, recipient,
            appealRecipient, genlayerStateHash, decisionNonce, validAfter, validBefore
        ));
        require(_isAuthorized(instruction, authorization), "ProofBounty: bad authorization");

        require(b.registered, "ProofBounty: unregistered");
        Outcome outcome = Outcome(outcomeCode);
        consumedDecisions[genlayerStateHash] = true;
        b.decisionNonce = decisionNonce;

        if (outcome == Outcome.Winner) {
            Attempt storage a = attempts[bountyId][attemptIndex];
            require(!b.rewardSettled && !a.settled && a.challenger == recipient, "ProofBounty: winner mismatch");
            require(payoutBps > 0, "ProofBounty: zero payout");
            b.rewardSettled = true;
            a.settled = true;
            uint256 gross = b.reward * payoutBps / BPS;
            uint256 fee = gross * b.feeBps / BPS;
            claimable[recipient] += gross - fee + a.bond;
            _allocateAppeal(a, appealRecipient);
            claimable[treasury] += fee;
            claimable[b.creator] += b.reward - gross;
        } else if (outcome == Outcome.BountyRefund) {
            require(!b.rewardSettled && recipient == b.creator && payoutBps == 0, "ProofBounty: refund mismatch");
            b.rewardSettled = true;
            claimable[recipient] += b.reward;
        } else {
            Attempt storage a = attempts[bountyId][attemptIndex];
            require(!a.settled && a.challenger != address(0) && payoutBps == 0, "ProofBounty: attempt unavailable");
            a.settled = true;
            if (outcome == Outcome.BondRefund) {
                require(recipient == a.challenger, "ProofBounty: refund recipient");
            } else {
                require(recipient == b.creator, "ProofBounty: forfeit recipient");
            }
            claimable[recipient] += a.bond;
            _allocateAppeal(a, appealRecipient);
        }
        emit DecisionExecuted(bountyId, attemptIndex, outcome, genlayerStateHash);
    }

    function recoverOrphanBounty(uint256 bountyId) external nonReentrant {
        Bounty storage b = bounties[bountyId];
        require(msg.sender == b.creator && !b.registered && !b.rewardSettled, "ProofBounty: recovery unavailable");
        require(block.timestamp >= uint256(b.fundedAt) + ORPHAN_DELAY, "ProofBounty: recovery delay");
        uint256 amount = b.reward;
        // Release the predictable bounty ID after accounting for the refund.
        // The credited claim remains a contract liability, while the slot can
        // be funded again under a fresh creator authorization.
        delete bounties[bountyId];
        claimable[msg.sender] += amount;
        emit OrphanRecovered(bountyId, msg.sender, amount);
    }

    function claim() external nonReentrant {
        uint256 amount = claimable[msg.sender];
        require(amount > 0, "ProofBounty: nothing claimable");
        claimable[msg.sender] = 0;
        require(usdc.transfer(msg.sender, amount), "ProofBounty: transfer failed");
        emit Claimed(msg.sender, amount);
    }

    function setRelayer(address value) external onlyOwner { require(value != address(0), "ProofBounty: zero"); relayer = value; emit RelayerUpdated(value); }
    function setDecisionSigner(address value) external onlyOwner { require(value != address(0), "ProofBounty: zero"); decisionSigner = value; emit DecisionSignerUpdated(value); }
    function setTreasury(address value) external onlyOwner { require(value != address(0), "ProofBounty: zero"); treasury = value; emit TreasuryUpdated(value); }
    function transferOwnership(address value) external onlyOwner { require(value != address(0), "ProofBounty: zero"); owner = value; emit OwnershipTransferred(value); }

    function _allocateAppeal(Attempt storage a, address appealRecipient) private {
        if (a.appealBond == 0) {
            require(appealRecipient == address(0), "ProofBounty: unexpected appeal recipient");
            return;
        }
        require(appealRecipient != address(0), "ProofBounty: missing appeal recipient");
        claimable[appealRecipient] += a.appealBond;
    }

    function _isAuthorized(bytes32 structHash, bytes calldata signature) private view returns (bool) {
        bytes32 domain = keccak256(abi.encode(
            DOMAIN_TYPEHASH, keccak256("ProofBountyEscrow"), keccak256("1"), block.chainid, address(this)
        ));
        return _recover(keccak256(abi.encodePacked("\x19\x01", domain, structHash)), signature) == decisionSigner;
    }

    function _recover(bytes32 digest, bytes calldata signature) private pure returns (address signer) {
        require(signature.length == 65, "ProofBounty: signature length");
        bytes32 r; bytes32 s; uint8 v;
        assembly { r := calldataload(signature.offset) s := calldataload(add(signature.offset, 32)) v := byte(0, calldataload(add(signature.offset, 64))) }
        require(v == 27 || v == 28, "ProofBounty: signature v");
        require(uint256(s) <= SECP256K1_HALF_ORDER, "ProofBounty: signature s");
        signer = ecrecover(digest, v, r, s);
        require(signer != address(0), "ProofBounty: bad signature");
    }
}
