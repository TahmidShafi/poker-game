import type { Metadata, Viewport } from "next";
import { GameProvider } from "../lib/store";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hold'em Club — private poker tables",
  description: "A premium real-time Texas Hold'em room for friends. Virtual chips only.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#0b0f14",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans text-white antialiased">
        <GameProvider>{children}</GameProvider>
      </body>
    </html>
  );
}
