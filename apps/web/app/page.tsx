import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { BountyList } from "@/components/bounty/BountyList";

const LIFECYCLE_STEPS = [
  {
    number: "01 & 02",
    icon: "add_box",
    title: "Create & Lock",
    body: "Define the exact parameters of your claim and precommitted proof criteria. Lock a GEN reward in an immutable escrow contract that can only be released upon cryptographic verification.",
    span: "md:col-span-2",
  },
  {
    number: "03",
    icon: "search",
    title: "Prove",
    body: "Challengers submit evidence — on-chain transactions, APIs, or public documents — that they believe satisfies the criteria, locking a performance bond to attempt it.",
    span: "md:col-span-1",
  },
  {
    number: "04",
    icon: "balance",
    title: "Evaluate",
    body: "The contract itself fetches the evidence URL live and GenLayer validators reach consensus on whether the fetched content satisfies the precommitted criteria.",
    span: "md:col-span-1",
  },
  {
    number: "05",
    icon: "payments",
    title: "Settle",
    body: "Once consensus is reached, the contract automatically routes the locked reward directly to the successful challenger's wallet — full, partial, or refunded.",
    span: "md:col-span-2",
  },
];

export default function LandingPage() {
  return (
    <>
      {/* Hero */}
      <section className="relative pt-24 md:pt-32 pb-24 overflow-hidden px-4 md:px-16 max-w-[1280px] mx-auto min-h-[70vh] flex items-center">
        <div className="relative z-10 max-w-3xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-electric-blue/30 bg-electric-blue/5 mb-6">
            <span className="w-2 h-2 rounded-full bg-electric-blue animate-pulse" />
            <span className="font-mono-data text-[11px] tracking-widest text-electric-blue uppercase">
              The Source of Truth
            </span>
          </div>
          <h1 className="font-headline text-4xl md:text-5xl font-bold text-on-surface mb-6 leading-tight tracking-tight">
            Put money behind a claim.
            <br />
            Then let the internet <span className="text-gradient">prove</span> whether you earned it.
          </h1>
          <p className="font-body text-lg text-on-surface-variant mb-10 max-w-2xl">
            A decentralized marketplace where financial stakes meet cryptographic truth. Post
            bounties for real-world or on-chain events, verified by GenLayer&apos;s validator
            consensus against live web evidence — never a submitter&apos;s own claim.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Link href="/create">
              <Button size="lg">
                Create a Bounty
                <span className="material-symbols-outlined text-[18px]">+</span>
              </Button>
            </Link>
            <Link href="/explore">
              <Button size="lg" variant="secondary">
                Explore Proofs
              </Button>
            </Link>
          </div>
          <div className="mt-12 flex flex-wrap items-center gap-6 font-mono-data text-[11px] text-on-surface-variant/60">
            <span>Secure</span>
            <span>Decentralized</span>
            <span>Immutable</span>
          </div>
        </div>
      </section>

      {/* Lifecycle */}
      <section className="py-24 px-4 md:px-16 max-w-[1280px] mx-auto">
        <div className="mb-12">
          <h2 className="font-headline text-2xl font-semibold text-on-surface mb-2">
            The Verification Lifecycle
          </h2>
          <p className="font-body text-on-surface-variant">From claim to settlement without intermediaries.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {LIFECYCLE_STEPS.map((step) => (
            <div
              key={step.title}
              className={`glass-panel p-8 rounded-xl flex flex-col justify-between hover:border-action-green/30 transition-colors ${step.span}`}
            >
              <div className="flex justify-between items-start mb-12">
                <div className="w-12 h-12 rounded bg-surface flex items-center justify-center border border-white/10 text-action-green font-mono-data text-xs">
                  {step.number}
                </div>
              </div>
              <div>
                <h3 className="font-headline text-xl text-on-surface mb-3">{step.title}</h3>
                <p className="font-body text-sm text-on-surface-variant">{step.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Marketplace preview — live contract data */}
      <section className="py-24 bg-surface-container-lowest border-y border-white/5">
        <div className="px-4 md:px-16 max-w-[1280px] mx-auto">
          <div className="flex justify-between items-end mb-12">
            <div>
              <h2 className="font-headline text-2xl font-semibold text-on-surface mb-2">Active Bounties</h2>
              <p className="font-body text-on-surface-variant">High-stakes claims awaiting verification.</p>
            </div>
            <Link href="/explore" className="hidden md:flex text-electric-blue font-mono-data text-xs items-center gap-1 hover:opacity-80">
              View All →
            </Link>
          </div>
          <BountyList limit={6} />
        </div>
      </section>

      {/* GenLayer section */}
      <section className="py-24 px-4 md:px-16 max-w-[1280px] mx-auto">
        <div className="glass-panel rounded-2xl p-8 md:p-16 flex flex-col md:flex-row items-center gap-12 relative overflow-hidden border-t-2 border-t-electric-blue">
          <div className="md:w-1/2 relative z-10">
            <div className="inline-flex items-center gap-2 mb-6">
              <span className="font-mono-data text-[11px] tracking-widest text-on-surface-variant uppercase">
                Powered by GenLayer
              </span>
            </div>
            <h2 className="font-headline text-3xl md:text-4xl font-bold text-on-surface mb-6">
              Intelligent Evaluation at the Protocol Level
            </h2>
            <p className="font-body text-on-surface-variant mb-8">
              PROOFBOUNTY&apos;s Intelligent Contract fetches every piece of evidence itself, live,
              at evaluation time — then asks GenLayer&apos;s validator consensus to judge only that
              fetched content against criteria that were locked before the evidence ever existed.
              No centralized judge. No crude multi-sig. No trusting a challenger&apos;s own account
              of what their evidence shows.
            </p>
            <a
              href="https://docs.genlayer.com"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-electric-blue font-mono-data text-xs hover:underline"
            >
              Read the Technical Docs →
            </a>
          </div>
          <div className="md:w-1/2 w-full relative z-10 flex flex-col gap-4">
            {[
              { label: "Evidence Submitted", sub: "Fetched live from the evidence URL", icon: "1" },
              { label: "GenLayer Consensus", sub: "Validators evaluate against locked criteria", icon: "2" },
              { label: "Bounty Settled", sub: "Reward routed on-chain to the winner", icon: "3" },
            ].map((row, i) => (
              <div
                key={row.label}
                className={`bg-surface rounded-lg p-4 border border-white/5 flex items-center gap-4 ${
                  i === 1 ? "border-l-2 border-l-electric-blue" : ""
                }`}
              >
                <div className="w-8 h-8 rounded-full bg-surface-container-highest flex items-center justify-center text-on-surface-variant font-mono-data text-xs">
                  {row.icon}
                </div>
                <div className="flex-1">
                  <div className="font-mono-data text-sm text-on-surface">{row.label}</div>
                  <div className="text-[10px] text-on-surface-variant">{row.sub}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
