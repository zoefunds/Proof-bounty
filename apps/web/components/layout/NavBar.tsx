import Link from "next/link";
import Image from "next/image";
import { ConnectWalletButton } from "./ConnectWalletButton";
import { NotificationBell } from "./NotificationBell";

const LINKS = [
  { href: "/explore", label: "Explore Proofs" },
  { href: "/create", label: "Create Bounty" },
  { href: "/dashboard", label: "My Dashboard" },
  { href: "/disputes", label: "Disputes" },
];

export function NavBar() {
  return (
    <nav className="sticky top-0 z-50 border-b border-white/10 bg-surface/80 backdrop-blur-md">
      <div className="flex justify-between items-center w-full px-4 md:px-16 max-w-[1280px] mx-auto h-16">
        <Link href="/" className="flex items-center gap-2 font-headline text-xl font-bold text-on-surface">
          <Image src="/logo-mark.svg" alt="" width={28} height={28} priority />
          PROOFBOUNTY
        </Link>
        <div className="hidden md:flex items-center gap-6 font-body text-sm">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-on-surface-variant hover:text-primary-fixed transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <NotificationBell />
          <ConnectWalletButton />
        </div>
      </div>
    </nav>
  );
}
