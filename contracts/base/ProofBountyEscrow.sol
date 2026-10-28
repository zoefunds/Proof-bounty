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
    }

    struct Attempt {
        address challenger;
        uint256 bond;
        uint256 appealBond;
        address appealPayer;
        bool settled;
    }

    IERC20 public immutable usdc;
    address public owner;
    address public relayer;
    address public decisionSigner;
    address public treasury;
    bool private locked;

    uint256 public constant BPS = 10_000;
    uint256 public constant ORPHAN_DELAY = 7 days;
    uint256 private constant SECP256K1_HALF_ORDER =
        0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;
    bytes32 private constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 private constant REGISTER_TYPEHASH = keccak256(
        "Register(uint256 bountyId,address creator,uint256 reward,uint256 requiredBond,uint16 feeBps,address genlayerContract)"
    );
    bytes32 private constant SETTLE_TYPEHASH = keccak256(
        "Settle(uint256 bountyId,uint256 attemptIndex,uint8 outcome,uint16 payoutBps,address recipient,address appealRecipient,bytes32 decisionHash)"
    );
    bytes32 private constant ORPHAN_TYPEHASH = keccak256(
        "Orphan(uint256 bountyId,address creator,uint256 reward)"
    );

    mapping(uint256 => Bounty) public bounties;
    mapping(uint256 => mapping(uint256 => Attempt)) public attempts;
    mapping(address => uint256) public claimable;
    mapping(bytes32 => bool) public consumedDecisions;

    event BountyFunded(uint256 indexed bountyId, address indexed creator, uint256 reward, uint256 requiredBond);
    event BountyRegistered(uint256 indexed bountyId, address indexed genlayerContract);
    event AttemptFunded(uint256 indexed bountyId, uint256 indexed attemptIndex, address indexed challenger, uint256 bond);
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

    /// Fund after the GenLayer create transaction has assigned bountyId.
    /// Registration later binds this deposit to that exact GenLayer contract.
    function fundBounty(uint256 bountyId, uint256 reward, uint256 requiredBond, uint16 feeBps) external nonReentrant {
        require(reward > 0 && feeBps <= 1_000, "ProofBounty: invalid bounty");
        Bounty storage b = bounties[bountyId];
        require(b.creator == address(0), "ProofBounty: already funded");
        require(usdc.transferFrom(msg.sender, address(this), reward), "ProofBounty: transferFrom failed");
        b.creator = msg.sender;
        b.reward = reward;
        b.requiredBond = requiredBond;
        b.feeBps = feeBps;
        b.fundedAt = uint64(block.timestamp);
        emit BountyFunded(bountyId, msg.sender, reward, requiredBond);
    }

    function registerBounty(uint256 bountyId, address genlayerContract, bytes calldata authorization) external onlyRelayer {
        Bounty storage b = bounties[bountyId];
        require(b.creator != address(0) && !b.registered && !b.rewardSettled, "ProofBounty: registration unavailable");
        require(genlayerContract != address(0), "ProofBounty: zero GenLayer contract");
        bytes32 instruction = keccak256(abi.encode(
            REGISTER_TYPEHASH, bountyId, b.creator, b.reward, b.requiredBond, b.feeBps, genlayerContract
        ));
        require(_isAuthorized(instruction, authorization), "ProofBounty: bad authorization");
        b.registered = true;
        b.genlayerContract = genlayerContract;
        emit BountyRegistered(bountyId, genlayerContract);
    }

    function fundAttempt(uint256 bountyId, uint256 attemptIndex) external nonReentrant {
        Bounty storage b = bounties[bountyId];
        require(b.registered && !b.rewardSettled, "ProofBounty: bounty unavailable");
        Attempt storage a = attempts[bountyId][attemptIndex];
        require(a.challenger == address(0), "ProofBounty: attempt funded");
        if (b.requiredBond > 0) {
            require(usdc.transferFrom(msg.sender, address(this), b.requiredBond), "ProofBounty: transferFrom failed");
        }
        a.challenger = msg.sender;
        a.bond = b.requiredBond;
        emit AttemptFunded(bountyId, attemptIndex, msg.sender, b.requiredBond);
    }

    function fundAppeal(uint256 bountyId, uint256 attemptIndex) external nonReentrant {
        Bounty storage b = bounties[bountyId];
        Attempt storage a = attempts[bountyId][attemptIndex];
        require(b.registered && !a.settled && a.challenger != address(0), "ProofBounty: appeal unavailable");
        require(a.appealBond == 0 && b.requiredBond > 0, "ProofBounty: appeal bond unavailable");
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
        bytes32 decisionHash,
        bytes calldata authorization
    ) external onlyRelayer {
        require(outcomeCode >= uint8(Outcome.Winner) && outcomeCode <= uint8(Outcome.BountyRefund), "ProofBounty: bad outcome");
        require(decisionHash != bytes32(0) && !consumedDecisions[decisionHash], "ProofBounty: decision consumed");
        require(recipient != address(0) && payoutBps <= BPS, "ProofBounty: bad instruction");
        bytes32 instruction = keccak256(abi.encode(
            SETTLE_TYPEHASH, bountyId, attemptIndex, outcomeCode, payoutBps, recipient, appealRecipient, decisionHash
        ));
        require(_isAuthorized(instruction, authorization), "ProofBounty: bad authorization");

        Bounty storage b = bounties[bountyId];
        require(b.registered, "ProofBounty: unregistered");
        Outcome outcome = Outcome(outcomeCode);
        consumedDecisions[decisionHash] = true;

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
        emit DecisionExecuted(bountyId, attemptIndex, outcome, decisionHash);
    }

    function recoverOrphanBounty(uint256 bountyId, bytes calldata authorization) external nonReentrant {
        Bounty storage b = bounties[bountyId];
        require(msg.sender == b.creator && !b.registered && !b.rewardSettled, "ProofBounty: recovery unavailable");
        require(block.timestamp >= uint256(b.fundedAt) + ORPHAN_DELAY, "ProofBounty: recovery delay");
        bytes32 instruction = keccak256(abi.encode(ORPHAN_TYPEHASH, bountyId, b.creator, b.reward));
        require(_isAuthorized(instruction, authorization), "ProofBounty: bad authorization");
        b.rewardSettled = true;
        claimable[msg.sender] += b.reward;
        emit OrphanRecovered(bountyId, msg.sender, b.reward);
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
