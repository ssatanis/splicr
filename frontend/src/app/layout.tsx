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
  title: "App | SplicR",
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
        {/* SVG filters for colorblind mode (referenced by globals.css) */}
        <svg aria-hidden="true" className="absolute w-0 h-0 overflow-hidden">
          <defs>
            <filter id="protanopia" colorInterpolationFilters="sRGB">
              <feColorMatrix type="matrix" values="0.10889 0.89111 0 0 0  0.10889 0.89111 0 0 0  0.00447 -0.00447 1 0 0  0 0 0 1 0" />
            </filter>
            <filter id="deuteranopia" colorInterpolationFilters="sRGB">
              <feColorMatrix type="matrix" values="0.29031 0.70969 0 0 0  0.29031 0.70969 0 0 0  -0.02197 0.02197 1 0 0  0 0 0 1 0" />
            </filter>
            <filter id="tritanopia" colorInterpolationFilters="sRGB">
              <feColorMatrix type="matrix" values="1.01277 0.13548 -0.14826 0 0  -0.01243 0.86812 0.14431 0 0  0.07589 0.80500 0.11911 0 0  0 0 0 1 0" />
            </filter>
          </defs>
        </svg>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
