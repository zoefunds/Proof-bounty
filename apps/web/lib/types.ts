export interface BountyDetail {
  bounty_id: number;
  creator: string;
  arbiter: string;
  title: string;
  claim_text: string;
  claim_polarity: "POSITIVE" | "NEGATIVE";
  category: string;
  proof_criteria: string;
  evidence_requirements: string;
  status: number;
  status_label: string;
  reward_amount: string | number;
  reward_deposited: string | number;
  required_bond: string | number;
  platform_fee_bps: number;
  attempt_count: number;
  attempts_won: number;
  winning_attempt_index: number;
  criteria_locked: boolean;
  deadline: number;
  created_at: number;
}

export interface AttemptDetail {
  bounty_id: number;
  index: number;
  challenger: string;
  bond_amount: string | number;
  bond_deposited: string | number;
  status: number;
  status_label: string;
  evidence_url: string;
  evidence_description: string;
  revision_count: number;
  max_revisions: number;
  last_verdict: string;
  last_reasoning: string;
  last_payout_bps: number;
  evidence_content_hash: string;
  evidence_fetched_at: number;
  disputed_by: string;
  dispute_reason: string;
  pending_arbiter_verdict: string;
  pending_payout_bps: number;
  appeal_deadline: number;
  appealed_by: string;
  appeal_reason: string;
  appeal_bond_deposited: string | number;
  created_at: number;
  submitted_at: number;
  resolved_at: number;
  resolved_by_arbiter: boolean;
}

export interface ReputationSummary {
  address: string;
  bounties_created: number;
  bounties_funded_total: string | number;
  attempts_made: number;
  attempts_won: number;
  attempts_partial: number;
  attempts_rejected: number;
  attempts_disputed: number;
  total_earned: string | number;
}
