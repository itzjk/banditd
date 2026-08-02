import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const sans = IBM_Plex_Sans({
  variable: "--font-sans-face",
  subsets: ["latin"],
  display: "swap",
});

const mono = IBM_Plex_Mono({
  variable: "--font-mono-face",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

const title = "banditd, an agent that tests your ads and buys its own credits";

const description =
  "banditd researches your market, writes four ad creatives, measures which one wins on simulated traffic, and buys more render credits by itself through Prava, inside the limits you signed.";

const site = "https://banditd.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(site),
  title: {
    default: title,
    template: "%s | banditd",
  },
  description,
  applicationName: "banditd",
  category: "technology",
  keywords: [
    "agentic commerce",
    "autonomous agent",
    "ad creatives",
    "multi-armed bandit",
    "Thompson sampling",
    "anytime-valid inference",
    "Prava",
    "Visa Intelligent Commerce",
    "spend mandate",
  ],
  authors: [{ name: "itzjk", url: "https://github.com/itzjk" }],
  creator: "itzjk",
  publisher: "itzjk",
  alternates: {
    canonical: "/",
  },
  formatDetection: {
    telephone: false,
    email: false,
    address: false,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "banditd",
    locale: "en_US",
    title,
    description,
  },
  twitter: {
    card: "summary_large_image",
    title,
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
      className={`${sans.variable} ${mono.variable} h-full scroll-smooth antialiased`}
    >
      <body className="flex min-h-full flex-col overflow-x-hidden bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
