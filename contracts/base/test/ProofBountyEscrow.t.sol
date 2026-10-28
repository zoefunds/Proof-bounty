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
    address private constant CREATOR = address(0x1001);
    address private constant CHALLENGER = address(0x1002);
    address private constant RELAYER = address(0x1003);
    address private constant TREASURY = address(0x1004);
    address private constant GENLAYER = address(0x2001);
    uint256 private constant REWARD = 100_000_000;
    uint256 private constant BOND = 20_000_000;
    uint16 private constant FEE = 500;
    bytes32 private constant DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant REGISTER_TYPEHASH = keccak256("Register(uint256 bountyId,address creator,uint256 reward,uint256 requiredBond,uint16 feeBps,address genlayerContract)");
    bytes32 private constant SETTLE_TYPEHASH = keccak256("Settle(uint256 bountyId,uint256 attemptIndex,uint8 outcome,uint16 payoutBps,address recipient,address appealRecipient,bytes32 decisionHash)");
    bytes32 private constant ORPHAN_TYPEHASH = keccak256("Orphan(uint256 bountyId,address creator,uint256 reward)");

    MockUSDC token;
    ProofBountyEscrow escrow;

    function setUp() public {
        token = new MockUSDC();
        escrow = new ProofBountyEscrow(address(token), RELAYER, vm.addr(SIGNER_KEY), TREASURY);
        token.mint(CREATOR, REWARD * 2); token.mint(CHALLENGER, BOND * 3);
        vm.prank(CREATOR); token.approve(address(escrow), type(uint256).max);
        vm.prank(CHALLENGER); token.approve(address(escrow), type(uint256).max);
    }

    function testPartialWinnerConservesEveryUsdcUnit() public {
        _fundAndRegister(1);
        vm.prank(CHALLENGER); escrow.fundAttempt(1, 0);
        bytes32 decision = keccak256("partial");
        vm.prank(RELAYER); escrow.executeDecision(1, 0, 1, 7_500, CHALLENGER, address(0), decision, _settleSig(1, 0, 1, 7_500, CHALLENGER, address(0), decision));
        uint256 gross = REWARD * 7_500 / 10_000;
        uint256 fee = gross * FEE / 10_000;
        require(escrow.claimable(CHALLENGER) == gross - fee + BOND, "winner allocation");
        require(escrow.claimable(TREASURY) == fee, "fee allocation");
        require(escrow.claimable(CREATOR) == REWARD - gross, "creator remainder");
        require(escrow.claimable(CHALLENGER) + escrow.claimable(TREASURY) + escrow.claimable(CREATOR) == REWARD + BOND, "not conserved");
        vm.prank(RELAYER); vm.expectRevert(); escrow.executeDecision(1, 0, 1, 7_500, CHALLENGER, address(0), decision, _settleSig(1, 0, 1, 7_500, CHALLENGER, address(0), decision));
    }

    function testInstructionTamperingAndWrongRelayerRejected() public {
        _fundAndRegister(2);
        vm.prank(CHALLENGER); escrow.fundAttempt(2, 0);
        bytes32 decision = keccak256("winner");
        bytes memory auth = _settleSig(2, 0, 1, 10_000, CHALLENGER, address(0), decision);
        vm.prank(CREATOR); vm.expectRevert(); escrow.executeDecision(2, 0, 1, 10_000, CHALLENGER, address(0), decision, auth);
        vm.prank(RELAYER); vm.expectRevert(); escrow.executeDecision(2, 0, 1, 9_500, CHALLENGER, address(0), decision, auth);
        vm.prank(RELAYER); vm.expectRevert(); escrow.executeDecision(2, 0, 1, 10_000, CREATOR, address(0), decision, auth);
    }

    function testAppealBondCanPayCounterparty() public {
        _fundAndRegister(3);
        vm.prank(CHALLENGER); escrow.fundAttempt(3, 0);
        vm.prank(CHALLENGER); escrow.fundAppeal(3, 0);
        bytes32 decision = keccak256("appeal-lost");
        vm.prank(RELAYER); escrow.executeDecision(3, 0, 3, 0, CREATOR, CREATOR, decision, _settleSig(3, 0, 3, 0, CREATOR, CREATOR, decision));
        require(escrow.claimable(CREATOR) == BOND * 2, "forfeit plus appeal");
    }

    function testOrphanRecoveryRequiresDelayAndSignature() public {
        vm.prank(CREATOR); escrow.fundBounty(4, REWARD, BOND, FEE);
        vm.prank(CREATOR); vm.expectRevert(); escrow.recoverOrphanBounty(4, _orphanSig(4));
        vm.warp(block.timestamp + 7 days);
        vm.prank(CHALLENGER); vm.expectRevert(); escrow.recoverOrphanBounty(4, _orphanSig(4));
        vm.prank(CREATOR); escrow.recoverOrphanBounty(4, _orphanSig(4));
        require(escrow.claimable(CREATOR) == REWARD, "orphan refund");
    }

    function _fundAndRegister(uint256 id) private {
        vm.prank(CREATOR); escrow.fundBounty(id, REWARD, BOND, FEE);
        vm.prank(RELAYER); escrow.registerBounty(id, GENLAYER, _registerSig(id));
    }
    function _registerSig(uint256 id) private returns (bytes memory) {
        return _sign(keccak256(abi.encode(REGISTER_TYPEHASH, id, CREATOR, REWARD, BOND, FEE, GENLAYER)));
    }
    function _settleSig(uint256 id, uint256 idx, uint8 outcome, uint16 payout, address recipient, address appealRecipient, bytes32 decision) private returns (bytes memory) {
        return _sign(keccak256(abi.encode(SETTLE_TYPEHASH, id, idx, outcome, payout, recipient, appealRecipient, decision)));
    }
    function _orphanSig(uint256 id) private returns (bytes memory) {
        return _sign(keccak256(abi.encode(ORPHAN_TYPEHASH, id, CREATOR, REWARD)));
    }
    function _sign(bytes32 structHash) private returns (bytes memory) {
        bytes32 domain = keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256("ProofBountyEscrow"), keccak256("1"), block.chainid, address(escrow)));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domain, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, digest);
        return abi.encodePacked(r, s, v);
    }
}
