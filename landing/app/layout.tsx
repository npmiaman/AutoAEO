import type { Metadata } from "next";
import localFont from "next/font/local";
import { Instrument_Serif } from "next/font/google";
import "./globals.css";

const mondwest = localFont({
  src: "./fonts/PPMondwest-Regular.ttf",
  variable: "--mondwest",
  display: "swap",
});

const instrument = Instrument_Serif({
  weight: "400",
  subsets: ["latin"],
  variable: "--instrument",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Pigeon · get your site recommended by AI",
  description:
    "AI assistants now answer buying questions directly and recommend a handful of sites. Pigeon is the autonomous agent that measures where you're invisible to ChatGPT, Perplexity, and Gemini, fixes what's missing, and proves it worked. Shopify or any site.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${mondwest.variable} ${instrument.variable}`}>
      <body>{children}</body>
    </html>
  );
}
