import type { Metadata, Viewport } from "next";
import { Outfit } from "next/font/google";
import "./globals.css";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://splicr.org"),
  title: {
    default: "SplicR: the answer key for CRISPR screens",
    template: "%s · SplicR",
  },
  description:
    "For every hit in a CRISPR screen, SplicR tells you how likely it is to be real, why, and what to do next. Backed by every public screen re-analyzed the same way and a record of which hits held up.",
  openGraph: {
    title: "SplicR: the answer key for CRISPR screens",
    description:
      "Know which hits are real before you spend months validating them.",
    siteName: "SplicR",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#174f62",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth" className={`${outfit.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
