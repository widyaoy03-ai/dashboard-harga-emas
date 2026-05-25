import type { Portal, SourceConfig, SourceName, SourceValidationRow } from "./types";

export const portalContentTypes: Record<Portal, string[]> = {
  Beritasatu: ["Harga Emas", "Harga Perak"],
  "Investor Daily": [
    "Harga Emas Perhiasan",
    "Harga Emas Dunia",
    "Harga Emas ANTAM",
    "Harga Emas ANTAM, UBS, Galeri 24",
    "Harga Emas Digital",
    "Harga Emas Kecil"
  ]
};

export const menuItems = [
  "Overview",
  "Generate Artikel",
  "Data Harga Emas",
  "Histori",
  "Documentation",
  "Pengaturan"
];

export const sourceConfigs: SourceConfig[] = [
  {
    name: "Logam Mulia",
    url: "https://www.logammulia.com/id/harga-emas-hari-ini",
    mode: "otomatis",
    group: "antam",
    selectorSummary: "h2.ngc-title, tabel harga emas/perak, perubahan terakhir",
    parserType: "logam-mulia",
    titleSelector: "h2.ngc-title",
    dataSelector: "table.table-bordered",
    rowSelector: "table.table-bordered tr",
    fieldMapping: { weightIndex: 0, basePriceIndex: 1, pricePph025Index: 2, priceIndex: 1 },
    timestampSelector: "Perubahan terakhir",
    elementKeywords: ["Harga Emas Hari Ini", "Emas Batangan", "ngc-title"],
    boundaryStartKeywords: ["Emas Batangan"],
    boundaryStopKeywords: ["Gift Series", "Perak Murni", "Perak Heritage", "Perak", "Heritage"],
    excludeKeywords: ["Gift Series"],
    priceCurrency: "IDR"
  },
  {
    name: "Pegadaian",
    url: "https://pegadaian.co.id/produk/harga-emas-batangan-dan-tabungan-tabungan-emas",
    mode: "otomatis",
    group: "pegadaian",
    selectorSummary: "h3.title-desc, #pills-tab-harga-emasContent, tab UBS/Antam/Galeri 24",
    titleSelector: "h3.title-desc",
    dataSelector: "#pills-tab-harga-emasContent table",
    timestampSelector: "p.date-desc",
    elementKeywords: ["Harga Emas Batangan", "pills-tab-harga-emasContent", "Galeri 24", "UBS"],
    priceCurrency: "IDR",
    operationalNote: "Galeri24 diambil dari tabel Pegadaian, bukan source mandiri."
  },
  {
    name: "Kitco",
    url: "https://www.kitco.com/charts/gold",
    mode: "otomatis",
    group: "dunia",
    selectorSummary: "Live gold Price dan nilai spot di halaman chart",
    titleSelector: "Live gold Price",
    dataSelector: "nilai spot pada live chart",
    timestampSelector: "NY Time",
    elementKeywords: ["Live", "gold", "Price"],
    priceCurrency: "USD"
  },
  {
    name: "Investing",
    url: "https://id.investing.com/currencies/xau-usd",
    mode: "otomatis",
    group: "dunia",
    selectorSummary: "h1 XAU/USD dan data-test instrument-price-last",
    titleSelector: "h1",
    dataSelector: "[data-test='instrument-price-last']",
    timestampSelector: "instrument timestamp",
    elementKeywords: ["XAU/USD", "instrument-price-last"],
    priceCurrency: "USD"
  },
  {
    name: "Raja Emas",
    url: "https://rajaemasindonesia.co.id/#hargaemas",
    mode: "otomatis",
    group: "perhiasan",
    selectorSummary: "Section #hargaemas, header Kadar Karat/Harga per Gram, parser khusus per-karat",
    parserType: "raja-emas",
    titleSelector: "h2#hargaemas",
    dataSelector: "table",
    rowSelector: "table tr",
    fieldMapping: { weightIndex: 0, priceIndex: 1, productTypeIndex: 0 },
    elementKeywords: ["Harga Beli Emas Hari Ini di Raja Emas Indonesia", "Kadar Karat", "Harga per Gram"],
    includeKeywords: ["Kadar Karat", "Harga per Gram", "K24", "K5"],
    excludeKeywords: ["Lokasi Kami", "Bandingkan dengan tempat lain", "Klik di sini", "Tempat Jual Emas Terpercaya"],
    boundaryStartKeywords: ["Kadar Karat", "Harga per Gram"],
    boundaryStopKeywords: ["Jenis Logam Mulia", "Lokasi Kami", "Bandingkan dengan tempat lain"],
    priceCurrency: "IDR"
  },
  {
    name: "Laku Emas",
    url: "https://www.lakuemas.com/",
    mode: "otomatis",
    group: "perhiasan",
    selectorSummary: "table.table-bordered, harga beli/jual",
    dataSelector: "table.table-bordered",
    elementKeywords: ["Harga Beli", "Harga Jual", "Gram"],
    priceCurrency: "IDR"
  },
  {
    name: "BSI",
    url: "https://www.bankbsi.co.id/",
    mode: "otomatis",
    group: "emas-kecil",
    selectorSummary: "#nav-emas, kurs-update-date, harga 1 gram",
    dataSelector: "#nav-emas",
    timestampSelector: ".kurs-update-date",
    elementKeywords: ["nav-emas", "Diperbarui", "Rp 2.813.000"],
    priceCurrency: "IDR"
  },
  {
    name: "Emas Kita",
    url: "https://emaskita.id/Harga_emas",
    mode: "otomatis",
    group: "emas-kecil",
    selectorSummary: "Gold Rate Today, tabel basic price dan buyback",
    titleSelector: "Gold Rate Today",
    dataSelector: "table",
    timestampSelector: "Updated",
    elementKeywords: ["Gold Rate Today", "Updated", "Basic Price"],
    priceCurrency: "IDR"
  },
  {
    name: "Lotus Archi",
    url: "https://lotusarchi.com/pricing/",
    mode: "otomatis",
    group: "emas-kecil",
    selectorSummary: "HARGA EMAS, Gold Price /gram, Buyback Price, table.pricing",
    titleSelector: "HARGA EMAS",
    dataSelector: "table.pricing",
    timestampSelector: "Gold Price /gram",
    elementKeywords: ["HARGA EMAS", "Gold Price", "Buyback Price"],
    priceCurrency: "IDR"
  },
  {
    name: "Indogold",
    url: "https://www.indogold.id/harga-emas-hari-ini",
    mode: "otomatis",
    group: "digital",
    selectorSummary: "Harga Jual & Beli Emas Fisik Hari ini dan table.tw-table-auto",
    titleSelector: "h1.title",
    dataSelector: "table.tw-table-auto",
    elementKeywords: ["Harga Jual & Beli Emas Fisik Hari ini", "tw-table-auto"],
    priceCurrency: "IDR"
  },
  {
    name: "ShariaCoin",
    url: "https://shariacoin.co.id/harga-emas",
    mode: "otomatis",
    group: "digital",
    selectorSummary: "Tabel Harga Emas Bulan Ini, harga beli/jual",
    dataSelector: "Tabel Harga Emas",
    elementKeywords: ["Tabel Harga Emas", "ShariaCoin", "Harga"],
    priceCurrency: "IDR"
  },
  {
    name: "CNBC Metals",
    url: "https://www.cnbc.com/metals/",
    mode: "manual",
    group: "manual",
    selectorSummary: "Belum ada URL/selector final dari dokumen source",
    elementKeywords: [],
    priceCurrency: "USD",
    operationalNote: "Sementara editor mengambil data manual dari halaman CNBC Metals."
  },
  {
    name: "Treasury",
    url: "https://www.treasury.id/",
    mode: "manual",
    group: "manual",
    selectorSummary: "Belum ada URL/selector final dari dokumen source",
    elementKeywords: [],
    priceCurrency: "IDR",
    operationalNote: "Sementara editor mengambil data manual dari aplikasi Treasury."
  },
  {
    name: "Emasku",
    url: "https://emasku.co.id/",
    mode: "manual",
    group: "manual",
    selectorSummary: "Belum ada URL/selector final dari dokumen source",
    elementKeywords: [],
    priceCurrency: "IDR",
    operationalNote: "Sementara editor mengambil data manual dari aplikasi atau halaman Emasku."
  },
  {
    name: "Mini Gold (Instagram)",
    url: "https://www.instagram.com/minigoldindonesia/",
    mode: "manual",
    group: "manual",
    selectorSummary: "Instagram tidak dipakai sebagai source otomatis",
    elementKeywords: [],
    priceCurrency: "IDR",
    operationalNote: "Sementara editor mengambil data manual dari unggahan Instagram Mini Gold."
  },
  {
    name: "HRTA Gold",
    url: "https://hrtagold.id/en/gold-price",
    mode: "manual",
    group: "manual",
    selectorSummary: "Data diambil editor via aplikasi HRTA",
    elementKeywords: [],
    priceCurrency: "IDR",
    operationalNote: "Dimasukkan ke dokumentasi proses sebagai source manual sementara."
  }
];

export const contentSourceMap: Record<Portal, Record<string, SourceName[]>> = {
  Beritasatu: {
    "Harga Emas": ["Logam Mulia"],
    "Harga Perak": ["Logam Mulia"]
  },
  "Investor Daily": {
    "Harga Emas Perhiasan": ["Raja Emas", "Laku Emas"],
    "Harga Emas Dunia": ["Kitco", "Investing", "CNBC Metals"],
    "Harga Emas ANTAM": ["Logam Mulia"],
    "Harga Emas ANTAM, UBS, Galeri 24": ["Logam Mulia", "Pegadaian"],
    "Harga Emas Digital": ["Laku Emas", "Indogold", "ShariaCoin", "Treasury"],
    "Harga Emas Kecil": ["BSI", "Emas Kita", "Lotus Archi", "HRTA Gold", "Emasku", "Mini Gold (Instagram)"]
  }
};

export const preflightRows: SourceValidationRow[] = [
  { source: "Investing", statusAkses: "Berhasil", elementValid: "Ya", dataBerhasilDitarik: "Ya", catatan: "XAU/USD dan instrument-price-last valid via Chrome." },
  { source: "Logam Mulia", statusAkses: "Berhasil", elementValid: "Ya", dataBerhasilDitarik: "Ya", catatan: "Harga emas/perak dan perubahan terakhir terbaca." },
  { source: "Pegadaian", statusAkses: "Berhasil", elementValid: "Ya", dataBerhasilDitarik: "Ya", catatan: "UBS, Antam, dan Galeri24 terbaca dari tabel Pegadaian." },
  { source: "Kitco", statusAkses: "Berhasil", elementValid: "Ya", dataBerhasilDitarik: "Ya", catatan: "Live gold price dan sampel harga spot terbaca." },
  { source: "Raja Emas", statusAkses: "Berhasil", elementValid: "Ya", dataBerhasilDitarik: "Ya", catatan: "Tabel harga per karat terbaca." },
  { source: "Laku Emas", statusAkses: "Berhasil", elementValid: "Ya", dataBerhasilDitarik: "Ya", catatan: "Harga beli/jual dan tabel gram terbaca." },
  { source: "BSI", statusAkses: "Berhasil", elementValid: "Ya", dataBerhasilDitarik: "Ya", catatan: "nav-emas, timestamp, dan harga 1 gram terbaca." },
  { source: "Emas Kita", statusAkses: "Berhasil", elementValid: "Ya", dataBerhasilDitarik: "Ya", catatan: "Gold Rate Today, timestamp, basic price, dan buyback terbaca." },
  { source: "Lotus Archi", statusAkses: "Berhasil", elementValid: "Ya", dataBerhasilDitarik: "Ya", catatan: "Gold price, buyback, dan tabel pricing terbaca." },
  { source: "Indogold", statusAkses: "Berhasil", elementValid: "Ya", dataBerhasilDitarik: "Ya", catatan: "Judul dan table.tw-table-auto terbaca dari source terbaru." },
  { source: "ShariaCoin", statusAkses: "Berhasil", elementValid: "Ya", dataBerhasilDitarik: "Ya", catatan: "Tabel harga emas bulan ini terbaca." },
  { source: "CNBC Metals", statusAkses: "Manual", elementValid: "Manual", dataBerhasilDitarik: "Manual", catatan: "Sementara dicatat sebagai input manual editor." },
  { source: "Treasury", statusAkses: "Manual", elementValid: "Manual", dataBerhasilDitarik: "Manual", catatan: "Sementara dicatat sebagai input manual editor via aplikasi." },
  { source: "Emasku", statusAkses: "Manual", elementValid: "Manual", dataBerhasilDitarik: "Manual", catatan: "Sementara dicatat sebagai input manual editor." },
  { source: "Mini Gold (Instagram)", statusAkses: "Manual", elementValid: "Manual", dataBerhasilDitarik: "Manual", catatan: "Sementara dicatat sebagai input manual dari Instagram." },
  { source: "HRTA Gold", statusAkses: "Manual", elementValid: "Manual", dataBerhasilDitarik: "Manual", catatan: "Sementara dicatat sebagai input manual editor via aplikasi." }
];

export function getSourceConfig(name: SourceName) {
  return sourceConfigs.find((source) => source.name === name);
}

export function getSourcesForContent(portal: Portal, jenisKonten: string) {
  const sourceNames = contentSourceMap[portal]?.[jenisKonten] ?? [];
  return sourceNames.map((name) => getSourceConfig(name)).filter(Boolean) as SourceConfig[];
}
