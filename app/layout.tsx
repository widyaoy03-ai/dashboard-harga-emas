import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dashboard Workflow Harga Emas & Perak",
  description: "Otomasi workflow redaksi untuk konten Harga Emas & Perak Beritasatu dan Investor Daily"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
