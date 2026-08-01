import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const description =
  "banditd researches your market, writes four ad creatives, measures which one actually wins, and buys more render credits by itself through Prava, inside the limits you set.";

export const metadata: Metadata = {
  title: {
    default: "banditd, an agent that runs your ads and buys its own credits",
    template: "%s | banditd",
  },
  description,
  applicationName: "banditd",
  keywords: [
    "agentic commerce",
    "autonomous agent",
    "ad creatives",
    "multi-armed bandit",
    "Thompson sampling",
    "Prava",
    "spend mandate",
  ],
  authors: [{ name: "itzjk", url: "https://github.com/itzjk" }],
  openGraph: {
    title: "banditd",
    description,
    siteName: "banditd",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "banditd",
    description,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f6" },
    { media: "(prefers-color-scheme: dark)", color: "#08090a" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
