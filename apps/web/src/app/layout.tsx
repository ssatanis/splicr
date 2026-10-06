import type { Metadata, Viewport } from "next";
import { Inter, Instrument_Serif } from "next/font/google";
import "./globals.css";

const outfit = Inter({
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
    default: "SplicR",
    template: "%s | SplicR",
  },
  description:
    "CRISPR screen analysis and prediction research with traceable evidence, measured benchmarks and explicit uncertainty.",
  openGraph: {
    title: "SplicR | CRISPR Screen Evidence",
    description: "Explore measured results, analysis capabilities and scientific limitations.",
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
