import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import localFont from "next/font/local";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Marketing-page typefaces (used by the Pigeon landing at `/`).
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
  title: "Pigeon — get your site recommended by AI",
  description:
    "The autonomous AEO + SEO agent. Pigeon finds where you're invisible to ChatGPT, Perplexity, and Gemini, fixes what's missing, and proves it worked — on Shopify or any site.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${mondwest.variable} ${instrument.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
