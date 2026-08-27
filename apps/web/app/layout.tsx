import type { Metadata } from "next";
import { Hanken_Grotesk, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { WalletProvider } from "@/lib/wallet-context";
import { NavBar } from "@/components/layout/NavBar";
import { Footer } from "@/components/layout/Footer";

const hankenGrotesk = Hanken_Grotesk({
  variable: "--font-headline",
  subsets: ["latin"],
  weight: ["600", "700"],
});

const inter = Inter({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono-data",
  subsets: ["latin"],
  weight: ["500"],
});

export const metadata: Metadata = {
  title: {
    default: "PROOFBOUNTY — Cryptographic Truth Marketplace",
    template: "%s — PROOFBOUNTY",
  },
  description:
    "Put money behind a claim. Then let the internet prove whether you earned it. A GenLayer-verified marketplace for financially-backed, evidence-checked public claims.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${hankenGrotesk.variable} ${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-charcoal-bg text-on-surface">
        <WalletProvider>
          <NavBar />
          <main className="flex-grow flex flex-col">{children}</main>
          <Footer />
        </WalletProvider>
      </body>
    </html>
  );
}
