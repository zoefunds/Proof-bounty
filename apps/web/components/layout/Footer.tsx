import Link from "next/link";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/disputes", label: "Disputes" },
  { href: "https://docs.genlayer.com", label: "GenLayer Docs" },
  { href: "https://github.com", label: "GitHub" },
];

export function Footer() {
  return (
    <footer className="border-t border-white/5 py-12 px-4 md:px-16 max-w-[1280px] mx-auto w-full mt-auto grid grid-cols-1 md:grid-cols-4 gap-6">
      <div className="text-primary font-headline text-xl font-bold">
        PROOFBOUNTY
        <p className="font-body text-xs text-on-surface-variant font-normal mt-2 opacity-80">
          © {new Date().getFullYear()} PROOFBOUNTY. Powered by GenLayer.
        </p>
      </div>
      <div className="md:col-span-3 flex flex-wrap gap-6 md:justify-end items-start font-body text-sm">
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="text-on-surface-variant hover:text-action-green transition-colors opacity-80 hover:opacity-100"
          >
            {link.label}
          </Link>
        ))}
      </div>
    </footer>
  );
}
