"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@/lib/wallet-context";
import { useContractWrite } from "@/lib/use-contract-write";
import { toGenWei } from "@/lib/format";
import { VALID_CATEGORIES } from "@/lib/contract-config";
import { Button } from "@/components/ui/Button";
import { GlassInput, GlassTextarea, Label } from "@/components/ui/Card";
import { TxStateBanner } from "@/components/ui/TxStateBanner";

const STEPS = [
  { id: 1, title: "Claim & Title", sub: "Basic information" },
  { id: 2, title: "Proof Criteria", sub: "Validation rules" },
  { id: 3, title: "Evidence", sub: "Required documentation" },
  { id: 4, title: "Economics", sub: "Reward, bond & deadline" },
  { id: 5, title: "Review", sub: "Finalize & sign" },
] as const;

const DEADLINE_PRESETS = [
  { label: "3 days", seconds: 3 * 24 * 3600 },
  { label: "7 days", seconds: 7 * 24 * 3600 },
  { label: "14 days", seconds: 14 * 24 * 3600 },
  { label: "30 days", seconds: 30 * 24 * 3600 },
];

export default function CreateBountyPage() {
  const router = useRouter();
  const { address } = useWallet();
  const [step, setStep] = useState(1);

  const [title, setTitle] = useState("");
  const [claimText, setClaimText] = useState("");
  const [polarity, setPolarity] = useState<"POSITIVE" | "NEGATIVE">("POSITIVE");
  const [category, setCategory] = useState<string>(VALID_CATEGORIES[0]);
  const [criteria, setCriteria] = useState<string[]>([""]);
  const [evidenceRequirements, setEvidenceRequirements] = useState("");
  const [reward, setReward] = useState("");
  const [bond, setBond] = useState("0");
  const [deadlineSeconds, setDeadlineSeconds] = useState(DEADLINE_PRESETS[1].seconds);
  const [arbiter, setArbiter] = useState("");

  const createTx = useContractWrite();

  const canProceedStep1 = title.trim().length > 0 && claimText.trim().length > 0;
  const canProceedStep2 = criteria.some((c) => c.trim().length > 0);
  const canProceedStep4 = Number(reward) > 0 && arbiter.trim().length > 0;

  async function handleCreate() {
    const proofCriteria = criteria
      .filter((c) => c.trim())
      .map((c, i) => `${i + 1}. ${c.trim()}`)
      .join("\n");

    const ok = await createTx.write({
      functionName: "create_bounty",
      args: [
        title.trim(),
        claimText.trim(),
        polarity,
        category,
        proofCriteria,
        evidenceRequirements.trim(),
        arbiter.trim(),
        deadlineSeconds,
        toGenWei(bond || "0"),
      ],
      value: toGenWei(reward),
    });
    if (ok) {
      setStep(6); // success screen
    }
  }

  if (!address) {
    return (
      <main className="flex-grow flex items-center justify-center px-4 py-24">
        <div className="glass-panel rounded-xl p-10 text-center max-w-md">
          <h1 className="font-headline text-2xl text-on-surface mb-3">Connect Your Wallet</h1>
          <p className="font-body text-sm text-on-surface-variant">
            You need a connected wallet to create and fund a bounty — the reward is locked from
            your wallet in the same transaction that creates the bounty.
          </p>
        </div>
      </main>
    );
  }

  if (step === 6) {
    return (
      <main className="flex-grow flex items-center justify-center px-4 py-24">
        <div className="glass-panel rounded-xl p-10 text-center max-w-md border-t-4 border-t-action-green">
          <h1 className="font-headline text-2xl text-on-surface mb-3">Bounty Created</h1>
          <p className="font-body text-sm text-on-surface-variant mb-6">
            Your claim is now live and funded on-chain. Challengers can accept it and start
            submitting evidence.
          </p>
          <Button onClick={() => router.push("/explore")}>View Marketplace</Button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-grow flex flex-col items-center p-4 md:p-6 max-w-[1024px] mx-auto w-full my-8">
      <div className="w-full mb-8 flex flex-col md:flex-row justify-between items-end gap-4">
        <div>
          <h1 className="font-headline text-3xl md:text-4xl text-on-surface tracking-tight">
            Create Bounty
          </h1>
          <p className="font-body text-on-surface-variant mt-2">
            Define cryptographic truth parameters and economic stakes for a new verifiable bounty.
          </p>
        </div>
        <span className="font-mono-data text-xs text-on-surface-variant">DRAFT — UNPUBLISHED</span>
      </div>

      <div className="w-full glass-panel rounded-xl flex flex-col md:flex-row overflow-hidden shadow-2xl">
        {/* Stepper */}
        <div className="w-full md:w-64 bg-deep-navy/50 border-r border-border-subtle p-6 flex flex-col gap-4">
          <div className="font-mono-data text-[11px] tracking-widest uppercase text-on-surface-variant mb-2">
            Steps
          </div>
          {STEPS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => s.id < step && setStep(s.id)}
              className="flex items-start gap-4 text-left"
            >
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center font-mono-data text-[10px] shrink-0 mt-0.5 ${
                  s.id < step
                    ? "border border-action-green text-action-green bg-slate-surface"
                    : s.id === step
                    ? "bg-action-green text-charcoal-bg"
                    : "bg-slate-surface text-on-surface-variant border border-border-subtle"
                }`}
              >
                {s.id < step ? "✓" : s.id}
              </div>
              <div>
                <div className={`font-mono-data text-[11px] uppercase tracking-wide ${s.id <= step ? "text-on-surface" : "text-on-surface-variant"}`}>
                  {s.title}
                </div>
                <div className="font-body text-xs text-on-surface-variant">{s.sub}</div>
              </div>
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-grow p-6 md:p-8 flex flex-col min-h-[500px]">
          {step === 1 && (
            <StepShell title="Define the Claim" sub="What is the verifiable event or state you are creating a bounty for?">
              <div>
                <Label>Bounty Title</Label>
                <GlassInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g., Protocol X documentation contradicts its own audit" />
              </div>
              <div>
                <Label>Claim</Label>
                <GlassTextarea rows={4} value={claimText} onChange={(e) => setClaimText(e.target.value)} placeholder="What do you believe can be publicly demonstrated?" />
              </div>
              <div>
                <Label>Claim Type</Label>
                <div className="grid grid-cols-2 gap-3">
                  {(["POSITIVE", "NEGATIVE"] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPolarity(p)}
                      className={`p-3 glass-input rounded-md text-sm font-mono-data ${polarity === p ? "border-electric-blue bg-electric-blue/10 text-electric-blue" : "text-on-surface"}`}
                    >
                      {p === "POSITIVE" ? "Prove it happened" : "Prove it failed / violated"}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Label>Category</Label>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {VALID_CATEGORIES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCategory(c)}
                      className={`p-3 glass-input rounded-md text-xs font-mono-data ${category === c ? "border-electric-blue bg-electric-blue/10 text-electric-blue" : "text-on-surface"}`}
                    >
                      {c.replace(/_/g, " ")}
                    </button>
                  ))}
                </div>
              </div>
            </StepShell>
          )}

          {step === 2 && (
            <StepShell title="Proof Criteria" sub="Specify exact, boolean conditions that GenLayer validators will evaluate against fetched evidence.">
              <div className="space-y-4">
                {criteria.map((c, i) => (
                  <div key={i} className="flex gap-3 items-start">
                    <div className="w-8 h-8 rounded bg-surface-container-highest flex items-center justify-center font-mono-data text-xs text-on-surface-variant shrink-0 mt-1">
                      {i + 1}
                    </div>
                    <GlassInput
                      value={c}
                      onChange={(e) => {
                        const next = [...criteria];
                        next[i] = e.target.value;
                        setCriteria(next);
                      }}
                      placeholder="e.g., The page must state the exact commit hash of the fix"
                    />
                    {criteria.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setCriteria(criteria.filter((_, idx) => idx !== i))}
                        className="mt-2 text-on-surface-variant hover:text-status-rejected shrink-0"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setCriteria([...criteria, ""])}
                  className="text-action-green font-mono-data text-xs hover:text-primary-fixed"
                >
                  + Add Criterion
                </button>
              </div>
              <p className="font-body text-xs text-on-surface-variant mt-4">
                These criteria are locked immutable the moment the first challenger accepts this
                bounty — they cannot be changed afterward.
              </p>
            </StepShell>
          )}

          {step === 3 && (
            <StepShell title="Evidence Requirements" sub="What kind of publicly-accessible evidence is acceptable?">
              <GlassTextarea
                rows={5}
                value={evidenceRequirements}
                onChange={(e) => setEvidenceRequirements(e.target.value)}
                placeholder="e.g., A public URL (repo, documentation page, transaction explorer, governance forum post) demonstrating the claim."
              />
            </StepShell>
          )}

          {step === 4 && (
            <StepShell title="Stakes & Deadline" sub="Set the reward, optional performance bond, arbiter, and deadline.">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Reward (GEN)</Label>
                  <GlassInput type="number" min="0" step="0.01" value={reward} onChange={(e) => setReward(e.target.value)} placeholder="100" />
                </div>
                <div>
                  <Label>Required Bond (GEN, 0 = none)</Label>
                  <GlassInput type="number" min="0" step="0.01" value={bond} onChange={(e) => setBond(e.target.value)} placeholder="0" />
                </div>
              </div>
              <div>
                <Label>Arbiter Address</Label>
                <GlassInput value={arbiter} onChange={(e) => setArbiter(e.target.value)} placeholder="0x... (can be your own address to self-arbitrate)" />
              </div>
              <div>
                <Label>Deadline</Label>
                <div className="flex flex-wrap gap-2">
                  {DEADLINE_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => setDeadlineSeconds(preset.seconds)}
                      className={`px-3 py-1.5 rounded-full border font-mono-data text-xs ${
                        deadlineSeconds === preset.seconds
                          ? "border-action-green text-action-green bg-action-green/10"
                          : "border-border-subtle text-on-surface-variant"
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            </StepShell>
          )}

          {step === 5 && (
            <StepShell title="Review & Sign" sub="Confirm every parameter before locking your reward on-chain.">
              <div className="space-y-3 font-body text-sm">
                <ReviewRow label="Title" value={title} />
                <ReviewRow label="Claim" value={claimText} />
                <ReviewRow label="Type" value={`${polarity} · ${category.replace(/_/g, " ")}`} />
                <ReviewRow label="Criteria" value={criteria.filter(Boolean).join(" / ")} />
                <ReviewRow label="Reward" value={`${reward || 0} GEN`} />
                <ReviewRow label="Bond" value={`${bond || 0} GEN`} />
                <ReviewRow label="Arbiter" value={arbiter} />
                <ReviewRow label="Deadline" value={`${Math.round(deadlineSeconds / 86400)} days from now`} />
              </div>
              <TxStateBanner state={createTx.state} txHash={createTx.txHash} errorMessage={createTx.errorMessage} />
            </StepShell>
          )}

          {/* Nav */}
          <div className="mt-8 flex justify-between">
            {step > 1 ? (
              <Button variant="ghost" onClick={() => setStep(step - 1)}>
                ← Back
              </Button>
            ) : (
              <span />
            )}
            {step < 5 ? (
              <Button
                onClick={() => setStep(step + 1)}
                disabled={
                  (step === 1 && !canProceedStep1) ||
                  (step === 2 && !canProceedStep2) ||
                  (step === 4 && !canProceedStep4)
                }
              >
                Next Step →
              </Button>
            ) : (
              <Button onClick={handleCreate} isLoading={createTx.isBusy}>
                Sign & Create Bounty
              </Button>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function StepShell({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col flex-grow gap-6">
      <div>
        <h2 className="font-headline text-2xl text-on-surface">{title}</h2>
        <p className="font-body text-sm text-on-surface-variant mt-1">{sub}</p>
      </div>
      <div className="space-y-6 flex-grow">{children}</div>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 border-b border-border-subtle pb-2">
      <span className="font-mono-data text-[10px] uppercase tracking-wide text-on-surface-variant">{label}</span>
      <span className="text-on-surface">{value || "—"}</span>
    </div>
  );
}
