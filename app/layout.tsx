import type { Metadata, Viewport } from "next";
import { Space_Grotesk, Unbounded } from "next/font/google";
import "./globals.css";

const unbounded = Unbounded({
  subsets: ["latin"],
  variable: "--font-unbounded",
  weight: ["500", "700", "900"],
});

const grotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-grotesk",
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "SplitParty, split the damage",
  description:
    "Log who paid for what. SplitParty does the math and squares everyone up in the fewest payments possible. No accounts, just a code.",
};

export const viewport: Viewport = {
  themeColor: "#19191d",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${unbounded.variable} ${grotesk.variable}`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
