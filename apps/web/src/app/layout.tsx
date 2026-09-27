import type { Metadata, Viewport } from "next";
import { Instrument_Serif, Outfit } from "next/font/google";
import "./globals.css";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  display: "swap",
});

// Used only for the largest display headlines. A serif at that size reads as
// editorial rather than as another product landing page.
const serif = Instrument_Serif({
  variable: "--font-instrument",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://splicr.org"),
  title: {
    default: "SplicR: the answer key for CRISPR screens",
    template: "%s · SplicR",
  },
  description:
    "For every hit in a CRISPR screen, SplicR tells you how likely it is to be real, why, and what to do next. Built on every public screen re-analyzed the same way, plus the record of which hits held up.",
  openGraph: {
    title: "SplicR: the answer key for CRISPR screens",
    description: "Know which hits are real before you spend months finding out.",
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
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${outfit.variable} ${serif.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
