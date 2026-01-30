import type { Metadata } from "next";
import { Instrument_Serif } from "next/font/google";
import "./globals.css";
import Providers from "./providers";

const instrumentSerif = Instrument_Serif({
  weight: ["400"],
  subsets: ["latin"],
  variable: "--font-instrument-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SplicR - CRISPR Screen Analysis",
  description: "Next-generation CRISPR screen analysis tool",
  icons: {
    icon: "/faviconslicr.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={instrumentSerif.variable} suppressHydrationWarning>
      <body className="font-serif" suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
