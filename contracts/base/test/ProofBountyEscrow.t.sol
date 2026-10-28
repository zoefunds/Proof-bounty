// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../ProofBountyEscrow.sol";

interface Vm {
    function prank(address) external;
    function expectRevert() external;
    function warp(uint256) external;
    function sign(uint256, bytes32) external returns (uint8, bytes32, bytes32);
    function addr(uint256) external returns (address);
}

contract MockUSDC is IERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
    function approve(address spender, uint256 amount) external returns (bool) { allowance[msg.sender][spender] = amount; return true; }
    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "balance"); balanceOf[msg.sender] -= amount; balanceOf[to] += amount; return true;
    }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount && allowance[from][msg.sender] >= amount, "funds/allowance");
        allowance[from][msg.sender] -= amount; balanceOf[from] -= amount; balanceOf[to] += amount; return true;
    }
}

contract ProofBountyEscrowTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant SIGNER_KEY = 0xA11CE;
    uint256 private constant WRONG_SIGNER_KEY = 0xB0B;
    address private constant CREATOR = address(0x1001);
    address private constant CHALLENGER = address(0x1002);
    address private constant RELAYER = address(0x1003);
    address private constant TREASURY = address(0x1004);
    address private constant GENLAYER = address(0x2001);
    address private constant ATTACKER = address(0x1005);
    uint256 private constant REWARD = 100_000_000;
    uint256 private constant BOND = 20_000_000;
    uint16 private constant FEE = 500;
    bytes32 private constant DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant REGISTER_TYPEHASH = keccak256("Register(uint256 bountyId,address creator,uint256 reward,uint256 requiredBond,uint16 feeBps,address genlayerContract)");
    bytes32 private constant SETTLE_TYPEHASH = keccak256("Settle(uint256 bountyId,uint256 attemptIndex,uint8 outcome,uint16 payoutBps,address recipient,address appealRecipient,bytes32 genlayerStateHash,uint256 decisionNonce,uint64 validAfter,uint64 validBefore)");
    bytes32 private constant FUND_ATTEMPT_TYPEHASH = keccak256("FundAttempt(uint256 bountyId,uint256 reservationId,address challenger,uint256 bond,address genlayerContract,uint64 authorizationExpiry)");
    bytes32 private constant BIND_ATTEMPT_TYPEHASH = keccak256("BindAttempt(uint256 bountyId,uint256 reservationId,uint256 attemptIndex,address challenger,bytes32 baseFundingTxHash)");

    MockUSDC token;
    ProofBountyEscrow escrow;

    function setUp() public {
        token = new MockUSDC();
        escrow = new ProofBountyEscrow(address(token), RELAYER, vm.addr(SIGNER_KEY), TREASURY);
        token.mint(CREATOR, REWARD * 2); token.mint(CHALLENGER, BOND * 3);
        token.mint(ATTACKER, BOND * 3);
        vm.prank(CREATOR); token.approve(address(escrow), type(uint256).max);
        vm.prank(CHALLENGER); token.approve(address(escrow), type(uint256).max);
        vm.prank(ATTACKER); token.approve(address(escrow), type(uint256).max);
    }

    function testPartialWinnerConservesEveryUsdcUnit() public {
        _fundAndRegister(1);
        _fundAndBindAttempt(1, 10, 0, CHALLENGER);
        bytes32 decision = keccak256("partial");
        vm.prank(RELAYER); escrow.executeDecision(1, 0, 1, 7_500, CHALLENGER, address(0), decision, 1, 0, type(uint64).max, _settleSig(1, 0, 1, 7_500, CHALLENGER, address(0), decision, 1, 0, type(uint64).max));
        uint256 gross = REWARD * 7_500 / 10_000;
        uint256 fee = gross * FEE / 10_000;
        require(escrow.claimable(CHALLENGER) == gross - fee + BOND, "winner allocation");
        require(escrow.claimable(TREASURY) == fee, "fee allocation");
        require(escrow.claimable(CREATOR) == REWARD - gross, "creator remainder");
        require(escrow.claimable(CHALLENGER) + escrow.claimable(TREASURY) + escrow.claimable(CREATOR) == REWARD + BOND, "not conserved");
        vm.prank(RELAYER); vm.expectRevert(); escrow.executeDecision(1, 0, 1, 7_500, CHALLENGER, address(0), decision, 1, 0, type(uint64).max, _settleSig(1, 0, 1, 7_500, CHALLENGER, address(0), decision, 1, 0, type(uint64).max));
    }

    function testInstructionTamperingAndWrongRelayerRejected() public {
        _fundAndRegister(2);
        _fundAndBindAttempt(2, 20, 0, CHALLENGER);
        bytes32 decision = keccak256("winner");
        bytes memory auth = _settleSig(2, 0, 1, 10_000, CHALLENGER, address(0), decision, 1, 0, type(uint64).max);
        vm.prank(CREATOR); vm.expectRevert(); escrow.executeDecision(2, 0, 1, 10_000, CHALLENGER, address(0), decision, 1, 0, type(uint64).max, auth);
        vm.prank(RELAYER); vm.expectRevert(); escrow.executeDecision(2, 0, 1, 9_500, CHALLENGER, address(0), decision, 1, 0, type(uint64).max, auth);
        vm.prank(RELAYER); vm.expectRevert(); escrow.executeDecision(2, 0, 1, 10_000, CREATOR, address(0), decision, 1, 0, type(uint64).max, auth);
    }

    function testAppealBondCanPayCounterparty() public {
        _fundAndRegister(3);
        _fundAndBindAttempt(3, 30, 0, CHALLENGER);
        vm.prank(CHALLENGER); escrow.fundAppeal(3, 0);
        bytes32 decision = keccak256("appeal-lost");
        vm.prank(RELAYER); escrow.executeDecision(3, 0, 3, 0, CREATOR, CREATOR, decision, 1, 0, type(uint64).max, _settleSig(3, 0, 3, 0, CREATOR, CREATOR, decision, 1, 0, type(uint64).max));
        require(escrow.claimable(CREATOR) == BOND * 2, "forfeit plus appeal");
    }

    function testOrphanRecoveryRequiresDelayButNoPrivilegedSignature() public {
        vm.prank(CREATOR); escrow.fundBounty(4, REWARD, BOND, FEE);
        vm.prank(CREATOR); vm.expectRevert(); escrow.recoverOrphanBounty(4);
        vm.warp(block.timestamp + 7 days);
        vm.prank(CHALLENGER); vm.expectRevert(); escrow.recoverOrphanBounty(4);
        vm.prank(CREATOR); escrow.recoverOrphanBounty(4);
        require(escrow.claimable(CREATOR) == REWARD, "orphan refund");
    }

    function testAttemptFundingIsIdentityBoundAndSquattingFails() public {
        _fundAndRegister(5);
        uint64 expiry = uint64(block.timestamp + 1 hours);
        bytes memory challengerAuth = _fundSig(5, 50, CHALLENGER, expiry);
        vm.prank(ATTACKER); vm.expectRevert(); escrow.fundAttempt(5, 50, expiry, challengerAuth);
        vm.prank(CHALLENGER); escrow.fundAttempt(5, 50, expiry, challengerAuth);
        bytes32 fundingTx = keccak256("funding-50");
        vm.prank(RELAYER); escrow.bindAttempt(5, 50, 0, fundingTx, _bindSig(5, 50, 0, CHALLENGER, fundingTx));
        (address bound,,,,,uint256 reservationId) = escrow.attempts(5, 0);
        require(bound == CHALLENGER && reservationId == 50, "wrong binding");
    }

    function testUnboundAttemptRecoveryNeedsNoPrivilegedSignature() public {
        _fundAndRegister(6);
        uint64 expiry = uint64(block.timestamp + 1 hours);
        vm.prank(CHALLENGER); escrow.fundAttempt(6, 60, expiry, _fundSig(6, 60, CHALLENGER, expiry));
        vm.warp(uint256(expiry) + 1 days);
        vm.prank(CHALLENGER); escrow.recoverPendingAttempt(6, 60);
        require(escrow.claimable(CHALLENGER) == BOND, "pending bond not recovered");
    }

    function testStaleAndConflictingSettlementInstructionsFail() public {
        _fundAndRegister(7);
        _fundAndBindAttempt(7, 70, 0, CHALLENGER);
        _fundAndBindAttempt(7, 71, 1, CHALLENGER);
        bytes32 stateOne = keccak256("state-one");
        uint64 validBefore = uint64(block.timestamp + 10 minutes);
        vm.prank(RELAYER); escrow.executeDecision(7, 0, 2, 0, CHALLENGER, address(0), stateOne, 1, 0, validBefore, _settleSig(7, 0, 2, 0, CHALLENGER, address(0), stateOne, 1, 0, validBefore));
        bytes32 stateTwo = keccak256("state-two");
        vm.prank(RELAYER); vm.expectRevert(); escrow.executeDecision(7, 1, 2, 0, CHALLENGER, address(0), stateTwo, 1, 0, validBefore, _settleSig(7, 1, 2, 0, CHALLENGER, address(0), stateTwo, 1, 0, validBefore));
        bytes32 expired = keccak256("expired-state");
        uint64 expiredAt = uint64(block.timestamp + 1);
        bytes memory expiredSig = _settleSig(7, 1, 2, 0, CHALLENGER, address(0), expired, 2, 0, expiredAt);
        vm.warp(block.timestamp + 2);
        vm.prank(RELAYER); vm.expectRevert(); escrow.executeDecision(7, 1, 2, 0, CHALLENGER, address(0), expired, 2, 0, expiredAt, expiredSig);
        bytes32 unauthorized = keccak256("unauthorized-state");
        vm.prank(RELAYER); vm.expectRevert(); escrow.executeDecision(7, 1, 2, 0, CHALLENGER, address(0), unauthorized, 2, 0, type(uint64).max, _settleSigWithKey(WRONG_SIGNER_KEY, 7, 1, 2, 0, CHALLENGER, address(0), unauthorized, 2, 0, type(uint64).max));
    }

    function testEndToEndFundBindSettleAndRecipientClaim() public {
        _fundAndRegister(8);
        _fundAndBindAttempt(8, 80, 0, CHALLENGER);
        bytes32 finalizedState = keccak256("finalized-genlayer-winner-state");
        vm.prank(RELAYER); escrow.executeDecision(8, 0, 1, 10_000, CHALLENGER, address(0), finalizedState, 1, 0, type(uint64).max, _settleSig(8, 0, 1, 10_000, CHALLENGER, address(0), finalizedState, 1, 0, type(uint64).max));
        uint256 beforeBalance = token.balanceOf(CHALLENGER);
        uint256 expected = REWARD - (REWARD * FEE / 10_000) + BOND;
        vm.prank(CHALLENGER); escrow.claim();
        require(token.balanceOf(CHALLENGER) - beforeBalance == expected, "recipient did not receive settlement");
        require(escrow.claimable(CHALLENGER) == 0, "claim was not cleared");
    }

    function _fundAndRegister(uint256 id) private {
        vm.prank(CREATOR); escrow.fundBounty(id, REWARD, BOND, FEE);
        vm.prank(RELAYER); escrow.registerBounty(id, GENLAYER, _registerSig(id));
    }
    function _fundAndBindAttempt(uint256 id, uint256 reservationId, uint256 attemptIndex, address challenger) private {
        uint64 expiry = uint64(block.timestamp + 1 hours);
        vm.prank(challenger); escrow.fundAttempt(id, reservationId, expiry, _fundSig(id, reservationId, challenger, expiry));
        bytes32 fundingTx = keccak256(abi.encode(id, reservationId));
        vm.prank(RELAYER); escrow.bindAttempt(id, reservationId, attemptIndex, fundingTx, _bindSig(id, reservationId, attemptIndex, challenger, fundingTx));
    }
    function _registerSig(uint256 id) private returns (bytes memory) {
        return _sign(keccak256(abi.encode(REGISTER_TYPEHASH, id, CREATOR, REWARD, BOND, FEE, GENLAYER)));
    }
    function _fundSig(uint256 id, uint256 reservationId, address challenger, uint64 expiry) private returns (bytes memory) {
        return _sign(keccak256(abi.encode(FUND_ATTEMPT_TYPEHASH, id, reservationId, challenger, BOND, GENLAYER, expiry)));
    }
    function _bindSig(uint256 id, uint256 reservationId, uint256 idx, address challenger, bytes32 fundingTx) private returns (bytes memory) {
        return _sign(keccak256(abi.encode(BIND_ATTEMPT_TYPEHASH, id, reservationId, idx, challenger, fundingTx)));
    }
    function _settleSig(uint256 id, uint256 idx, uint8 outcome, uint16 payout, address recipient, address appealRecipient, bytes32 stateHash, uint256 nonce, uint64 validAfter, uint64 validBefore) private returns (bytes memory) {
        return _settleSigWithKey(SIGNER_KEY, id, idx, outcome, payout, recipient, appealRecipient, stateHash, nonce, validAfter, validBefore);
    }
    function _settleSigWithKey(uint256 signerKey, uint256 id, uint256 idx, uint8 outcome, uint16 payout, address recipient, address appealRecipient, bytes32 stateHash, uint256 nonce, uint64 validAfter, uint64 validBefore) private returns (bytes memory) {
        return _signWithKey(signerKey, keccak256(abi.encode(SETTLE_TYPEHASH, id, idx, outcome, payout, recipient, appealRecipient, stateHash, nonce, validAfter, validBefore)));
    }
    function _sign(bytes32 structHash) private returns (bytes memory) {
        return _signWithKey(SIGNER_KEY, structHash);
    }
    function _signWithKey(uint256 signerKey, bytes32 structHash) private returns (bytes memory) {
        bytes32 domain = keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256("ProofBountyEscrow"), keccak256("1"), block.chainid, address(escrow)));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domain, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);
        return abi.encodePacked(r, s, v);
    }
}
