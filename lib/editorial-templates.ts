import type { Portal } from "./types";

export interface TemplateProfile {
  portal: Portal;
  headlinePatterns: string[];
  bodyRhythm: string[];
  tone: string;
}

export const templateProfiles: Record<Portal, TemplateProfile> = {
  Beritasatu: {
    portal: "Beritasatu",
    headlinePatterns: [
      "Harga Emas Antam [hari tanggal] [gerak], Buyback Ikut [gerak]",
      "Harga Perak Antam Hari Ini [gerak] Ikuti Emas",
      "Harga Emas Dunia [waktu] [gerak] [sentimen utama]"
    ],
    bodyRhythm: [
      "Dateline Jakarta, Beritasatu.com lalu langsung ke harga utama.",
      "Paragraf kedua membandingkan dengan hari sebelumnya.",
      "Daftar harga per berat tampil sebagai blok ringkas.",
      "Konteks pajak atau sentimen pasar hanya dipakai jika relevan.",
      "Closing pendek, tidak terlalu analitis."
    ],
    tone: "cepat, to the point, newsroom style"
  },
  "Investor Daily": {
    portal: "Investor Daily",
    headlinePatterns: [
      "Harga Emas Antam (ANTM) Hari Ini, [hari tanggal]: [gerak]",
      "Harga Emas Perhiasan Hari Ini, [hari tanggal], Cek Rinciannya",
      "Harga Emas Hari Ini, [hari tanggal], di [source-source]",
      "Harga Emas Digital Hari Ini, [hari tanggal]: [gerak]"
    ],
    bodyRhythm: [
      "Dateline JAKARTA, investor.id dengan lead bisnis.",
      "Paragraf awal memberi arah harga dan implikasi untuk investor.",
      "Ada narasi market, demand, dolar AS, bank sentral, atau perilaku investor ritel.",
      "Daftar harga dibuat lengkap per source dan per berat.",
      "Closing memberi konteks keputusan beli/jual atau monitoring pasar."
    ],
    tone: "bisnis, market analysis, lebih panjang"
  }
};

export function chooseTemplateProfile(portal: Portal) {
  return templateProfiles[portal];
}
