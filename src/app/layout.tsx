import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Burgfried – Mittelalterliches Aufbaustrategiespiel",
  description: "Baue aus einer kleinen Siedlung eine große Stadt: Rohstoffe, Produktionsketten, Handel und Militär.",
};

// Kein Seiten-Zoom: das Spiel verwaltet Pinch-Zoom selbst
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#14301f",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de">
      <body className="antialiased">{children}</body>
    </html>
  );
}
