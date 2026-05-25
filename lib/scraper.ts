import { queryHtmlRows, queryHtmlSelections } from "./html-selector";
import { getRuntimeSourcesForContent } from "./admin-storage";
import { buildSourceDataViews } from "./source-data-view";
import { findPreviousSnapshot, saveSnapshots } from "./storage";
import type { DashboardNotification, GoldPriceRow, GoldPriceSnapshot, Portal, SourceConfig } from "./types";

const userAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

type FetchDiagnostics = {
  ok: boolean;
  status: number;
  statusText?: string;
  finalUrl: string;
  htmlSize: number;
  elapsedMs: number;
  attempts: number;
  contentType?: string | null;
  blockedHint?: string | null;
  errorName?: string | null;
  errorMessage?: string | null;
  sampleHtml?: string;
};

function browserLikeHeaders(url: string, attempt: number): HeadersInit {
  const isMobileFallback = attempt > 1;
  const baseUrl = new URL(url);
  return {
    "user-agent": isMobileFallback
      ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Mobile/15E148 Safari/604.1"
      : userAgent,
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "accept-language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
    "cache-control": "no-cache",
    pragma: "no-cache",
    referer: `${baseUrl.protocol}//${baseUrl.host}/`,
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "same-origin",
    "upgrade-insecure-requests": "1"
  };
}

function blockedHintFromHtml(html: string, status: number) {
  const sample = html.slice(0, 3000).toLowerCase();
  if ([401, 403, 429, 503].includes(status)) return `HTTP ${status} mengindikasikan akses ditolak/rate limited.`;
  if (/cloudflare|cf-ray|captcha|access denied|forbidden|blocked|bot detection|enable javascript/i.test(sample)) {
    return "Response mengandung indikasi proteksi anti-bot/captcha/access denied.";
  }
  if (html && html.length < 200) return "Response terlalu pendek sehingga kemungkinan kosong/truncated.";
  return null;
}

function todayJakarta() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function nowIso() {
  return new Date().toISOString();
}

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function decodeEntities(value: string) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(html: string) {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:tr|p|div|li|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  );
}

function htmlCellText(cell: string) {
  return stripTags(cell).replace(/\s+/g, " ").trim();
}

function tableRowsFromHtml(html: string, selector?: string) {
  if (selector?.trim()) {
    return queryHtmlRows(html, selector.trim()).map((row) => row.cells);
  }

  const rows: string[][] = [];
  const cleanHtml = html.replace(/<!--[\s\S]*?-->/g, " ");
  for (const rowMatch of cleanHtml.matchAll(/<tr[\s\S]*?<\/tr>/gi)) {
    const rowHtml = rowMatch[0];
    const cells = [...rowHtml.matchAll(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)]
      .map((match) => htmlCellText(match[1]))
      .filter(Boolean);
    if (cells.length) rows.push(cells);
  }
  return rows;
}

function scopedTextFromSelector(html: string, selector: string | undefined, fallbackText: string) {
  if (!selector?.trim()) return fallbackText;
  const selections = queryHtmlSelections(html, selector.trim());
  if (!selections.length) return "";
  return selections.map((selection) => selection.text).join("\n");
}

function normalizeWeight(value: string) {
  const clean = decodeEntities(value);
  const gram = clean.match(/\b(\d+(?:[.,]\d+)?)\s*(?:gram|gr)\b/i);
  if (gram) return `${gram[1].replace(",", ".")} gram`;
  const paperGold = clean.match(/\bPaper Gold\s+(\d+(?:[.,]\d+)?)\s*(?:gram|gr)\b/i);
  if (paperGold) return `Paper Gold ${paperGold[1].replace(",", ".")} gram`;
  const karat = clean.match(/\b(?:K\s?(\d{1,2})\*?|\d{1,2}\s*Karat)\b/i);
  if (karat) return clean.replace(/\s+/g, " ");
  const spot = clean.match(/\b(?:spot|ounce|ons|troi|troy)\b/i);
  if (spot) return "1 ons troi";
  return clean;
}

function looksLikeWeight(value: string) {
  return /(?:paper gold\s*)?\d+(?:[.,]\d+)?\s*(?:gram|gr)\b/i.test(value) || /\b(?:K\s?\d{1,2}\*?|\d{1,2}\s*Karat)\b/i.test(value);
}

function includesAny(value: string, keywords?: string[]) {
  const haystack = value.toLowerCase();
  return Boolean(keywords?.some((keyword) => keyword && haystack.includes(keyword.toLowerCase())));
}

function configuredRowSelector(source: SourceConfig) {
  if (source.rowSelector?.trim()) return source.rowSelector.trim();
  const dataSelector = source.dataSelector?.trim();
  if (!dataSelector) return undefined;
  if (dataSelector === "table" || dataSelector.includes("#") || dataSelector.includes(".") || dataSelector.includes(">") || dataSelector.includes("[") || /\btr\b/i.test(dataSelector)) {
    return dataSelector;
  }
  return undefined;
}

function cleanPrice(raw: string, currency: "IDR" | "USD") {
  const value = decodeEntities(raw).replace(/\s+/g, " ");
  const digitCount = value.replace(/\D/g, "").length;
  if (digitCount < 5) return null;
  if (currency === "USD") {
    const match = value.match(/([1-9]\d{0,2}(?:[.,]\d{3})+[.,]\d{2}|[1-9]\d{3}[.,]\d{2})/);
    return match ? `US$ ${match[1]}` : null;
  }

  const prefixed = value.match(/(?:Rp\.?|IDR)\s*([0-9]{1,3}(?:[.,][0-9]{3})+(?:,[0-9]{2})?)/i);
  if (prefixed) return `Rp ${prefixed[1]}`;

  const bare = value.match(/\b([0-9]{1,3}(?:[.,][0-9]{3}){1,}(?:,[0-9]{2})?)\b/);
  return bare ? `Rp ${bare[1]}` : null;
}

function priceCandidates(text: string, currency: "IDR" | "USD") {
  const values: string[] = [];
  const push = (raw: string) => {
    const formatted = cleanPrice(raw, currency);
    if (formatted && !values.includes(formatted)) values.push(formatted);
  };

  if (currency === "USD") {
    const regex = /\b([1-9]\d{0,2}(?:[.,]\d{3})+[.,]\d{2}|[1-9]\d{3}[.,]\d{2})\b/g;
    for (const match of text.matchAll(regex)) push(match[1]);
  } else {
    const prefixed = /(?:Rp\.?|IDR)\s*([0-9]{1,3}(?:[.,][0-9]{3})+(?:,[0-9]{2})?)/gi;
    for (const match of text.matchAll(prefixed)) push(`Rp ${match[1]}`);
    if (values.length < 2) {
      const bare = /\b([0-9]{1,3}(?:[.,][0-9]{3}){1,}(?:,[0-9]{2})?)\b/g;
      for (const match of text.matchAll(bare)) push(match[1]);
    }
  }

  return values.slice(0, 20);
}

function findTimestamp(text: string) {
  const patterns = [
    /\b(?:Diperbarui|Updated(?!At)|Terakhir update|Perubahan terakhir)\b[^\n<]{0,120}/i,
    /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+20\d{2}\s*-\s*\d{1,2}:\d{2}\s*NY Time\b/i,
    /\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|Mei|May|Jun|Jul|Agu|Aug|Sep|Okt|Oct|Nov|Des|Dec|April)\w*\s+20\d{2}\b/i,
    /Harga di-update setiap hari pkl\.\s*\d{1,2}\.\d{2}\s*WIB/i,
    /\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|Mei|May|Jun|Jul|Agu|Aug|Sep|Okt|Oct|Nov|Des|Dec|April)\w*\s+20\d{2}[^\n<]{0,80}/i,
    /\b20\d{2}-\d{2}-\d{2}(?!T)[^\n<]{0,40}/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return decodeEntities(match[0]).slice(0, 140);
  }

  return null;
}

function inferJenisEmas(source: SourceConfig, jenisKonten: string) {
  if (jenisKonten.toLowerCase().includes("perak")) return "Perak";
  if (source.name === "Kitco" || source.name === "Investing") return "Emas dunia spot";
  if (source.group === "perhiasan") return "Emas perhiasan";
  if (source.group === "digital") return "Emas digital";
  if (source.group === "emas-kecil") return "Emas kecil";
  return "Emas batangan";
}

function numberValue(value: string | null) {
  if (!value) return null;
  const cleaned = value.replace(/[^\d,.-]/g, "");
  if (!cleaned) return null;
  if (cleaned.includes(",") && cleaned.includes(".")) {
    const lastComma = cleaned.lastIndexOf(",");
    const lastDot = cleaned.lastIndexOf(".");
    if (lastComma > lastDot) return Number(cleaned.replace(/\./g, "").replace(",", "."));
    return Number(cleaned.replace(/,/g, ""));
  }
  if (cleaned.includes(",")) {
    const parts = cleaned.split(",");
    if (parts.at(-1)?.length === 2) return Number(cleaned.replace(/\./g, "").replace(",", "."));
    return Number(cleaned.replace(/,/g, ""));
  }
  return Number(cleaned.replace(/\./g, ""));
}

function priceNumber(raw: string | undefined, currency: "IDR" | "USD") {
  if (!raw) return null;
  const formatted = cleanPrice(raw, currency);
  return numberValue(formatted ?? raw);
}

function formatPriceNumber(value: number | null, currency: "IDR" | "USD") {
  if (value === null || Number.isNaN(value)) return null;
  if (currency === "USD") {
    return `US$ ${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `Rp ${value.toLocaleString("id-ID")}`;
}

function formatDelta(current: string | null, previous: string | null, currency: "IDR" | "USD") {
  const currentValue = numberValue(current);
  const previousValue = numberValue(previous);
  if (currentValue === null || previousValue === null || Number.isNaN(currentValue) || Number.isNaN(previousValue)) {
    return { delta: null, percentage: null };
  }

  const diff = currentValue - previousValue;
  const prefix = currency === "USD" ? "US$ " : "Rp ";
  const formatted = `${diff >= 0 ? "+" : "-"}${prefix}${Math.abs(diff).toLocaleString("id-ID", {
    maximumFractionDigits: currency === "USD" ? 2 : 0
  })}`;
  const percentage = previousValue === 0 ? null : `${diff >= 0 ? "+" : ""}${((diff / previousValue) * 100).toFixed(2)}%`;
  return { delta: formatted, percentage };
}

function createPriceRow(
  source: SourceConfig,
  jenisEmas: string,
  berat: string,
  harga: string | null,
  buyback: string | null,
  updateTime: string | null,
  sectionName?: string | null,
  meta: Partial<Pick<GoldPriceRow, "product_type" | "weight" | "base_price" | "price_pph_025" | "source" | "scraped_at">> = {}
): GoldPriceRow {
  return {
    id: crypto.randomUUID(),
    source_name: source.name,
    source_url: source.url,
    jenis_emas: jenisEmas,
    product_type: meta.product_type ?? sectionName ?? jenisEmas,
    weight: meta.weight ?? berat,
    base_price: meta.base_price !== undefined ? meta.base_price : priceNumber(harga ?? undefined, source.priceCurrency),
    price_pph_025: meta.price_pph_025 !== undefined ? meta.price_pph_025 : null,
    source: meta.source ?? source.name,
    scraped_at: meta.scraped_at ?? updateTime ?? nowIso(),
    section_name: sectionName ?? null,
    category: sectionName ?? null,
    berat,
    harga,
    buyback,
    waktu_update: updateTime,
    tanggal_update: updateTime,
    delta: null,
    percentage_change: null,
    previous_snapshot_date: null,
    previous_snapshot_run_time: null
  };
}

function priceRowFromCells(
  source: SourceConfig,
  jenisEmas: string,
  cells: string[],
  updateTime: string | null,
  sectionName?: string | null
) {
  const rowText = cells.join(" ");
  if (includesAny(rowText, source.excludeKeywords)) return null;
  if (source.includeKeywords?.length && !includesAny(rowText, source.includeKeywords)) return null;

  const mapping = source.fieldMapping ?? {};
  const weightCellIndex = mapping.weightIndex ?? cells.findIndex((cell) => looksLikeWeight(cell));
  if (weightCellIndex < 0) return null;

  const berat = normalizeWeight(cells[weightCellIndex]);
  const detectedPrices = cells.map((cell) => cleanPrice(cell, source.priceCurrency));
  const priceIndex = mapping.priceIndex ?? mapping.basePriceIndex ?? detectedPrices.findIndex((price, index) => index > weightCellIndex && Boolean(price));
  const basePriceIndex = mapping.basePriceIndex ?? priceIndex;
  const pphIndex = mapping.pricePph025Index;
  const mainPriceNumber = priceNumber(cells[priceIndex], source.priceCurrency);
  const basePrice = priceNumber(cells[basePriceIndex], source.priceCurrency);
  const pricePph025 = pphIndex === undefined ? null : priceNumber(cells[pphIndex], source.priceCurrency);

  if (mainPriceNumber === null && basePrice === null && pricePph025 === null) return null;
  return createPriceRow(source, jenisEmas, berat, formatPriceNumber(mainPriceNumber ?? basePrice ?? pricePph025, source.priceCurrency), null, updateTime, sectionName, {
    product_type: mapping.productTypeIndex === undefined ? sectionName ?? jenisEmas : cells[mapping.productTypeIndex],
    weight: berat,
    base_price: basePrice ?? mainPriceNumber,
    price_pph_025: pricePph025,
    source: source.name,
    scraped_at: updateTime ?? nowIso()
  });
}

function rowsFromHtmlTables(source: SourceConfig, jenisEmas: string, html: string, updateTime: string | null) {
  const rows: GoldPriceRow[] = [];
  const tableRows = tableRowsFromHtml(html, configuredRowSelector(source));
  const hasBoundary = Boolean(source.boundaryStartKeywords?.length);
  let capturing = !hasBoundary;

  for (const cells of tableRows) {
    const rowText = cells.join(" ");
    if (hasBoundary && includesAny(rowText, source.boundaryStartKeywords)) {
      capturing = true;
      continue;
    }
    if (capturing && source.boundaryStopKeywords?.length && includesAny(rowText, source.boundaryStopKeywords)) {
      break;
    }
    if (!capturing) continue;
    const row = priceRowFromCells(source, jenisEmas, cells, updateTime);
    if (row) rows.push(row);
  }

  return rows;
}

function tableRowSelectionsFromHtml(html: string, selector?: string) {
  const selected = selector?.trim() ? queryHtmlSelections(html, selector.trim()) : queryHtmlSelections(html, "tr");
  return selected
    .flatMap((selection) => (selection.tagName === "tr" ? [selection] : queryHtmlSelections(selection.html, "tr")))
    .filter((row) => row.cells.length);
}

const logamMuliaProductSections = ["Emas Batangan", "Perak Murni"] as const;
type LogamMuliaProductSection = (typeof logamMuliaProductSections)[number];

const logamMuliaSectionSlugs: Record<LogamMuliaProductSection, "emas_batangan" | "perak_murni"> = {
  "Emas Batangan": "emas_batangan",
  "Perak Murni": "perak_murni"
};

type LogamMuliaSkippedRow = {
  section: string | null;
  reason: string;
  sample: string;
};

function isLogamMuliaProductSection(value: string): value is LogamMuliaProductSection {
  const normalized = value.replace(/\s+/g, " ").trim().toLowerCase();
  return logamMuliaProductSections.some((section) => normalized === section.toLowerCase());
}

function sectionTitleFromRow(row: ReturnType<typeof queryHtmlSelections>[number]) {
  const hasHeaderCell = /<th\b/i.test(row.html);
  const hasDataCell = /<td\b/i.test(row.html);
  const isColspanHeader = /<th\b[^>]*\bcolspan\s*=/i.test(row.html);
  const isSingleHeaderCell = row.cells.length === 1 && hasHeaderCell && !hasDataCell;
  if (!isColspanHeader && !isSingleHeaderCell) return null;

  const title = row.cells.join(" ").replace(/\s+/g, " ").trim();
  if (!title || looksLikeWeight(title)) return null;
  if (row.cells.length > 1 && /berat|harga\s+dasar|pajak|pph|ppn/i.test(title)) return null;
  return title;
}

function matchTargetSection(sectionTitle: string, targetSections: readonly string[]) {
  const normalized = sectionTitle.replace(/\s+/g, " ").trim().toLowerCase();
  return targetSections.find((section) => normalized === section.toLowerCase()) ?? null;
}

function extractLogamMuliaSectionRows(
  source: SourceConfig,
  sectionName: LogamMuliaProductSection,
  html: string,
  text: string
) {
  const updateTime = findTimestamp(text);
  const rows: GoldPriceRow[] = [];
  let capturing = false;
  let targetSectionFound = false;
  let stoppedAtSection: string | null = null;
  let inspectedRows = 0;
  let invalidRowsSkipped = 0;
  const foundSections: string[] = [];
  const ignoredSections: string[] = [];
  const skippedRows: LogamMuliaSkippedRow[] = [];

  const trackSkipped = (reason: string, cells: string[]) => {
    invalidRowsSkipped += 1;
    if (skippedRows.length < 20) {
      skippedRows.push({
        section: capturing ? sectionName : null,
        reason,
        sample: cells.join(" | ").slice(0, 220)
      });
    }
  };

  for (const rowSelection of tableRowSelectionsFromHtml(html, configuredRowSelector(source))) {
    inspectedRows += 1;
    const cells = rowSelection.cells;
    const sectionTitle = sectionTitleFromRow(rowSelection);

    if (sectionTitle) {
      foundSections.push(sectionTitle);
      const matchedTarget = matchTargetSection(sectionTitle, [sectionName]);
      if (matchedTarget === sectionName) {
        capturing = true;
        targetSectionFound = true;
        continue;
      }
      ignoredSections.push(sectionTitle);
      if (capturing) stoppedAtSection = sectionTitle;
      if (capturing) break;
      continue;
    }

    if (!capturing) continue;
    if (!/<td\b/i.test(rowSelection.html)) {
      trackSkipped("row bukan data td", cells);
      continue;
    }
    if (cells.length < 3) {
      stoppedAtSection = "struktur row berubah";
      trackSkipped("kolom kurang dari 3", cells);
      continue;
    }
    if (!looksLikeWeight(cells[0] ?? "")) {
      trackSkipped("kolom berat tidak valid", cells);
      continue;
    }
    if (priceNumber(cells[1] ?? "", source.priceCurrency) === null || priceNumber(cells[2] ?? "", source.priceCurrency) === null) {
      trackSkipped("harga dasar atau harga pajak tidak numerik", cells);
      continue;
    }

    const row = priceRowFromCells(source, sectionName, cells, updateTime, sectionName);
    if (row) rows.push(row);
  }

  return {
    rows: dedupeRows(rows).slice(0, 80),
    targetSectionFound,
    stoppedAtSection,
    inspectedRows,
    invalidRowsSkipped,
    foundSections: [...new Set(foundSections)],
    ignoredSections: [...new Set(ignoredSections)],
    skippedRows
  };
}

function targetLogamMuliaSectionsForContent(jenisKonten: string): LogamMuliaProductSection[] {
  const lower = jenisKonten.toLowerCase();
  if (lower.includes("source-based") || lower.includes("emas/perak")) return ["Emas Batangan", "Perak Murni"];
  if (lower.includes("perak")) return ["Perak Murni"];
  return ["Emas Batangan"];
}

function parseLogamMuliaSections(source: SourceConfig, jenisKonten: string, html: string, text: string) {
  const targetSections = targetLogamMuliaSectionsForContent(jenisKonten);
  const parsed = targetSections.map((sectionName) => extractLogamMuliaSectionRows(source, sectionName, html, text));
  return {
    rows: dedupeRows(parsed.flatMap((section) => section.rows)).slice(0, 80),
    targetSectionFound: parsed.some((section) => section.targetSectionFound),
    stoppedAtSection: parsed.find((section) => section.stoppedAtSection)?.stoppedAtSection ?? null,
    inspectedRows: Math.max(...parsed.map((section) => section.inspectedRows), 0),
    invalidRowsSkipped: parsed.reduce((total, section) => total + section.invalidRowsSkipped, 0),
    foundSections: [...new Set(parsed.flatMap((section) => section.foundSections))],
    ignoredSections: [...new Set(parsed.flatMap((section) => section.ignoredSections))],
    skippedRows: parsed.flatMap((section) => section.skippedRows).slice(0, 30),
    sections: Object.fromEntries(targetSections.map((sectionName, index) => [sectionName, parsed[index]]))
  };
}

function rowsFromLogamMuliaSections(source: SourceConfig, jenisKonten: string, html: string, text: string) {
  return parseLogamMuliaSections(source, jenisKonten, html, text).rows;
}

type RajaEmasSkippedRow = {
  reason: string;
  sample: string;
};

function isRajaEmasParser(source: SourceConfig) {
  return source.parserType === "raja-emas" || source.name.toLowerCase().includes("raja emas");
}

type LakuEmasSkippedRow = {
  reason: string;
  sample: string;
};

type LakuEmasParseContext = {
  activeTabDetected?: boolean;
  parsedCategory?: string;
  ignoredCategories?: string[];
  endpointUrl?: string;
  sourceSelectorUsed?: string;
};

function isLakuEmasParser(source: SourceConfig) {
  return source.parserType === "laku-emas" || source.name.toLowerCase().includes("laku emas");
}

function isLakuKadarLabel(value: string) {
  const compact = value.replace(/\s+/g, "").toUpperCase();
  const withKPrefix = compact.match(/^K(\d{1,2})(?:\*|\(.+\))?$/);
  const withKSuffix = compact.match(/^(\d{1,2})K(?:\(.+\))?$/);
  const karat = Number(withKPrefix?.[1] ?? withKSuffix?.[1]);
  return Number.isFinite(karat) && karat >= 5 && karat <= 24;
}

function parseLakuEmasRows(source: SourceConfig, html: string, text: string, context: LakuEmasParseContext = {}) {
  const updateTime = findTimestamp(text) ?? nowIso();
  const selector = configuredRowSelector(source) ?? "table.table-bordered tbody tr";
  const rowSelections = tableRowSelectionsFromHtml(html, selector);
  const skippedRows: LakuEmasSkippedRow[] = [];
  const rows: GoldPriceRow[] = [];
  let headerFound = /kadar/i.test(text) && /harga\s*jual\s*\/?\s*gram/i.test(text);

  const trackSkip = (reason: string, sample: string) => {
    if (skippedRows.length < 20) skippedRows.push({ reason, sample: sample.slice(0, 220) });
  };

  for (const rowSelection of rowSelections) {
    const cells = rowSelection.cells.map((cell) => cell.replace(/\s+/g, " ").trim()).filter(Boolean);
    if (!cells.length) continue;
    const rowText = cells.join(" | ");

    if (/kadar/i.test(rowText) && /harga\s*jual/i.test(rowText)) {
      headerFound = true;
      continue;
    }
    if (cells.length < 2) {
      trackSkip("kolom kurang dari 2", rowText);
      continue;
    }

    const kadar = cells[0];
    const hargaJualPerGram = cleanPrice(cells[1], source.priceCurrency);
    if (!isLakuKadarLabel(kadar)) {
      trackSkip("row non-kadar/teks diabaikan", rowText);
      continue;
    }
    if (!hargaJualPerGram || !/^Rp/i.test(hargaJualPerGram)) {
      trackSkip("harga jual per gram tidak valid", rowText);
      continue;
    }

    rows.push(
      createPriceRow(source, "Emas perhiasan", kadar, hargaJualPerGram, null, updateTime, "PERHIASAN", {
        product_type: "Kadar",
        weight: kadar,
        base_price: null,
        price_pph_025: null,
        source: source.name,
        scraped_at: updateTime
      })
    );
  }

  return {
    selectorUsed: context.sourceSelectorUsed ?? selector,
    endpointUrl: context.endpointUrl ?? null,
    parsedCategory: context.parsedCategory ?? "PERHIASAN",
    activeTabDetected: context.activeTabDetected ?? headerFound,
    ignoredCategories: context.ignoredCategories ?? [],
    rowSelectionsCount: rowSelections.length,
    rows: dedupeRows(rows).slice(0, 60),
    validRows: rows.length,
    headerFound,
    skippedRows
  };
}

function isRajaKaratLabel(value: string) {
  const compact = value.replace(/\s+/g, "").toUpperCase();
  const match = compact.match(/^K(\d{1,2})\*?$/);
  if (!match) return false;
  const karat = Number(match[1]);
  return Number.isFinite(karat) && karat >= 5 && karat <= 24;
}

function parseRajaEmasRows(source: SourceConfig, html: string, text: string) {
  const updateTime = findTimestamp(text);
  const selector = configuredRowSelector(source) ?? "table tr";
  const rowSelections = tableRowSelectionsFromHtml(html, selector);
  const rows: GoldPriceRow[] = [];
  const skippedRows: RajaEmasSkippedRow[] = [];
  let headerFound = false;
  let capturing = false;
  let ignoredTextCount = 0;

  const trackSkip = (reason: string, sample: string) => {
    if (skippedRows.length < 20) skippedRows.push({ reason, sample: sample.slice(0, 220) });
    if (reason.toLowerCase().includes("teks") || reason.toLowerCase().includes("non")) ignoredTextCount += 1;
  };

  for (const rowSelection of rowSelections) {
    const cells = rowSelection.cells.map((cell) => cell.replace(/\s+/g, " ").trim()).filter(Boolean);
    if (!cells.length) continue;
    const rowText = cells.join(" | ");

    if (!headerFound && /kadar\s*karat/i.test(rowText) && /harga\s*per\s*gram/i.test(rowText)) {
      headerFound = true;
      capturing = true;
      continue;
    }

    if (!capturing) continue;
    if (/jenis\s*logam\s*mulia|lokasi\s*kami|bandingkan\s+dengan\s+tempat\s+lain/i.test(rowText)) {
      break;
    }

    if (cells.length < 2) {
      trackSkip("kolom kurang dari 2", rowText);
      continue;
    }

    const kadarKarat = cells[0];
    const hargaPerGram = cleanPrice(cells[1], source.priceCurrency);
    if (!isRajaKaratLabel(kadarKarat)) {
      trackSkip("row non-karat/teks diabaikan", rowText);
      continue;
    }
    if (!hargaPerGram || !/rp/i.test(hargaPerGram)) {
      trackSkip("harga per gram tidak valid", rowText);
      continue;
    }

    rows.push(
      createPriceRow(source, "Emas perhiasan", kadarKarat, hargaPerGram, null, updateTime, "Harga Perhiasan", {
        product_type: "Kadar Karat",
        weight: kadarKarat,
        base_price: null,
        price_pph_025: null,
        source: source.name,
        scraped_at: updateTime ?? nowIso()
      })
    );
  }

  return {
    selectorUsed: selector,
    rowSelectionsCount: rowSelections.length,
    rows: dedupeRows(rows).slice(0, 40),
    validRows: rows.length,
    headerFound,
    ignoredTextCount,
    skippedRows
  };
}

function rowsFromTextLines(source: SourceConfig, jenisEmas: string, text: string, updateTime: string | null) {
  const rows: GoldPriceRow[] = [];
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!looksLikeWeight(line)) continue;
    const next = [line, lines[index + 1] ?? "", lines[index + 2] ?? ""].join(" ");
    const prices = priceCandidates(next, source.priceCurrency);
    if (!prices.length) continue;
    rows.push(createPriceRow(source, jenisEmas, normalizeWeight(line), prices[0] ?? null, null, updateTime));
  }

  return rows;
}

function dedupeRows(rows: GoldPriceRow[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.source_name}|${row.category ?? ""}|${row.berat}|${row.harga}|${row.base_price ?? ""}|${row.price_pph_025 ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return Boolean(row.harga || row.base_price || row.price_pph_025);
  });
}

function extractPriceRows(source: SourceConfig, jenisKonten: string, html: string, text: string) {
  const jenisEmas = inferJenisEmas(source, jenisKonten);
  const updateTime = findTimestamp(text);

  if (source.parserType === "logam-mulia" || source.name === "Logam Mulia") {
    return rowsFromLogamMuliaSections(source, jenisKonten, html, text);
  }

  if (isRajaEmasParser(source)) {
    return parseRajaEmasRows(source, html, text).rows;
  }

  if (isLakuEmasParser(source)) {
    return parseLakuEmasRows(source, html, text).rows;
  }

  if (source.priceCurrency === "USD") {
    const prices = priceCandidates(text, "USD");
    return prices.length ? [createPriceRow(source, jenisEmas, "1 ons troi", prices[0], null, updateTime)] : [];
  }

  const selector = configuredRowSelector(source);
  const scopedText = selector ? scopedTextFromSelector(html, selector, text) : text;
  const tableRows = rowsFromHtmlTables(source, jenisEmas, html, updateTime);

  const textRows = tableRows.length ? [] : rowsFromTextLines(source, jenisEmas, scopedText, updateTime);
  const rows = dedupeRows([...tableRows, ...textRows]);

  if (rows.length) return rows.slice(0, 80);
  if (selector) return [];

  const fallbackPrices = priceCandidates(scopedText, source.priceCurrency);
  return fallbackPrices.length ? [createPriceRow(source, jenisEmas, "Satuan utama", fallbackPrices[0], null, updateTime)] : [];
}

function choosePrimaryRow(rows: GoldPriceRow[]) {
  return (
    rows.find((row) => /^1\s*gram$/i.test(row.berat)) ??
    rows.find((row) => /1\s*(?:gram|gr)\b/i.test(row.berat)) ??
    rows.find((row) => /ons|troi|spot/i.test(row.berat)) ??
    rows[0] ??
    null
  );
}

function applyHistoricalComparison(rows: GoldPriceRow[], previous: GoldPriceSnapshot | undefined, currency: "IDR" | "USD") {
  return rows.map((row) => {
    const previousRow = previous?.price_rows.find((item) => item.berat.toLowerCase() === row.berat.toLowerCase());
    const comparison = formatDelta(row.harga, previousRow?.harga ?? null, currency);
    return {
      ...row,
      delta: comparison.delta,
      percentage_change: comparison.percentage,
      previous_snapshot_date: previousRow ? previous?.tanggal_snapshot ?? null : null,
      previous_snapshot_run_time: previousRow ? previous?.run_time ?? null : null
    };
  });
}

async function fetchHtml(url: string, maxAttempts = 2) {
  let lastError: unknown = null;
  let lastDiagnostics: FetchDiagnostics | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch(url, {
        headers: browserLikeHeaders(url, attempt),
        redirect: "follow",
        signal: controller.signal,
        cache: "no-store"
      });

      const html = await response.text();
      lastDiagnostics = {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        finalUrl: response.url,
        htmlSize: html.length,
        elapsedMs: Date.now() - startedAt,
        attempts: attempt,
        contentType: response.headers.get("content-type"),
        blockedHint: blockedHintFromHtml(html, response.status),
        errorName: null,
        errorMessage: null,
        sampleHtml: html.slice(0, 500)
      };
      if (response.ok || attempt === maxAttempts) {
        return { ok: response.ok, status: response.status, statusText: response.statusText, finalUrl: response.url, html, diagnostics: lastDiagnostics };
      }
      console.warn(`[scraper] Fetch ${url} returned HTTP ${response.status}. Retry ${attempt}/${maxAttempts}.`);
    } catch (error) {
      lastError = error;
      const errorName = error instanceof Error ? error.name : "UnknownError";
      const cause = error && typeof error === "object" && "cause" in error ? (error as { cause?: unknown }).cause : null;
      const causeMessage =
        cause && typeof cause === "object"
          ? [("code" in cause ? String((cause as { code?: unknown }).code ?? "") : "").trim(), ("message" in cause ? String((cause as { message?: unknown }).message ?? "") : "").trim()]
              .filter(Boolean)
              .join(" - ")
          : "";
      const baseErrorMessage = error instanceof Error ? error.message : "Fetch source gagal.";
      const errorMessage = causeMessage ? `${baseErrorMessage} (${causeMessage})` : baseErrorMessage;
      lastDiagnostics = {
        ok: false,
        status: 0,
        finalUrl: url,
        htmlSize: 0,
        elapsedMs: Date.now() - startedAt,
        attempts: attempt,
        contentType: null,
        blockedHint: errorName === "AbortError" ? "Request timeout." : null,
        errorName,
        errorMessage,
        sampleHtml: ""
      };
      console.warn(`[scraper] Fetch ${url} failed on attempt ${attempt}/${maxAttempts}.`, error);
      if (attempt === maxAttempts) break;
    } finally {
      clearTimeout(timeout);
    }
    await wait(600 * attempt);
  }

  return {
    ok: false,
    status: 0,
    finalUrl: url,
    html: "",
    error: lastError instanceof Error ? `${lastError.name}: ${lastError.message}` : "Fetch source gagal.",
    diagnostics:
      lastDiagnostics ?? {
        ok: false,
        status: 0,
        finalUrl: url,
        htmlSize: 0,
        elapsedMs: 0,
        attempts: maxAttempts,
        contentType: null,
        blockedHint: null,
        errorName: lastError instanceof Error ? lastError.name : "UnknownError",
        errorMessage: lastError instanceof Error ? lastError.message : "Fetch source gagal.",
        sampleHtml: ""
      }
  };
}

type LakuEmasFetchContext = {
  landing: Awaited<ReturnType<typeof fetchHtml>>;
  fetched: Awaited<ReturnType<typeof fetchHtml>>;
  html: string;
  text: string;
  endpointUrl: string;
  parsedCategory: "PERHIASAN";
  activeTabDetected: boolean;
  categoriesDetected: string[];
  ignoredCategories: string[];
  sourceSelectorUsed: string;
};

function resolveLakuPerhiasanEndpoint(url: string) {
  const origin = new URL(url).origin;
  return `${origin}/harga-emas-fisik/brand/perhiasan`;
}

function lakuCategoriesFromLanding(html: string) {
  const categories = [...html.matchAll(/showPrice\('([^']+)'\)/gi)].map((match) => match[1].trim().toLowerCase()).filter(Boolean);
  return [...new Set(categories)];
}

async function fetchLakuEmasPerhiasanContext(source: SourceConfig, maxAttempts = 2): Promise<LakuEmasFetchContext> {
  const sourceSelectorUsed = configuredRowSelector(source) ?? "table.table-bordered tbody tr";
  const endpointUrl = resolveLakuPerhiasanEndpoint(source.url);
  const landing = await fetchHtml(source.url, maxAttempts);
  const categoriesDetected = landing.ok ? lakuCategoriesFromLanding(landing.html) : [];
  const endpointFetched = await fetchHtml(endpointUrl, maxAttempts);
  const activeTabDetected =
    categoriesDetected.includes("perhiasan") || (landing.ok && /id=["']perhiasan["']|showPrice\('perhiasan'\)/i.test(landing.html));
  const ignoredCategories = (categoriesDetected.length ? categoriesDetected : ["antam", "retro", "star_gold", "lm_other"]).filter(
    (category) => category !== "perhiasan"
  );
  const activeCategoryResponse = endpointFetched.ok && /kadar/i.test(endpointFetched.html) && /harga\s*jual\s*\/?\s*gram/i.test(endpointFetched.html);
  const fetched = endpointFetched.ok && endpointFetched.html.length >= 200 ? endpointFetched : landing;
  const html = fetched.html;

  return {
    landing,
    fetched,
    html,
    text: stripTags(html),
    endpointUrl,
    parsedCategory: "PERHIASAN",
    activeTabDetected: activeTabDetected || activeCategoryResponse,
    categoriesDetected,
    ignoredCategories,
    sourceSelectorUsed
  };
}

function fetchFailureMessage(sourceName: string, fetched: Awaited<ReturnType<typeof fetchHtml>>) {
  const diagnostics = fetched.diagnostics;
  if (diagnostics?.errorMessage) {
    return `Source ${sourceName} tidak dapat diakses. Detail teknis: ${diagnostics.errorName ?? "FetchError"} - ${diagnostics.errorMessage}.`;
  }
  if (diagnostics?.blockedHint) {
    return `Source ${sourceName} merespons, tetapi terindikasi diblokir. Detail: ${diagnostics.blockedHint}`;
  }
  if (!fetched.ok) {
    return `Source ${sourceName} mengembalikan HTTP ${fetched.status}${fetched.statusText ? ` ${fetched.statusText}` : ""}.`;
  }
  if ((diagnostics?.htmlSize ?? fetched.html.length) < 200) {
    return `Source ${sourceName} merespons, tetapi HTML kosong/terlalu pendek (${diagnostics?.htmlSize ?? fetched.html.length} karakter).`;
  }
  return `Source ${sourceName} sedang tidak dapat diakses.`;
}

function createLogamMuliaSourceConfig(url: string): SourceConfig {
  return {
    name: "Logam Mulia",
    url,
    mode: "otomatis",
    group: "antam",
    selectorSummary: "Section-aware parser untuk Emas Batangan dan Perak Murni",
    parserType: "logam-mulia",
    dataSelector: "table.table-bordered",
    rowSelector: "table.table-bordered tr",
    fieldMapping: {
      weightIndex: 0,
      priceIndex: 1,
      basePriceIndex: 1,
      pricePph025Index: 2
    },
    elementKeywords: [...logamMuliaProductSections],
    includeKeywords: [],
    excludeKeywords: [],
    boundaryStartKeywords: [...logamMuliaProductSections],
    boundaryStopKeywords: ["Gift Series", "Imlek", "Batik"],
    priceCurrency: "IDR",
    operationalNote: "Parser khusus Logam Mulia berbasis section marker."
  };
}

function logamMuliaOutputItem(row: GoldPriceRow) {
  const priceWithTax = row.price_pph_025 ?? priceNumber(row.harga ?? undefined, "IDR");
  return {
    weight: row.weight ?? row.berat,
    base_price: row.base_price ?? priceNumber(row.harga ?? undefined, "IDR"),
    price_pph_025: priceWithTax,
    final_price: priceWithTax
  };
}

export async function scrapeLogamMuliaProducts(url = "https://www.logammulia.com/id/harga-emas-hari-ini") {
  const source = createLogamMuliaSourceConfig(url);

  const fetched = await fetchHtml(url, 3);
  if (!fetched.ok || fetched.html.length < 200) {
    console.warn("[scraper:logam-mulia] URL tidak bisa diakses atau HTML kosong.", { url, status: fetched.status });
    throw new Error(`Logam Mulia tidak dapat diakses. HTTP ${fetched.status}.`);
  }

  const visibleText = stripTags(fetched.html);
  const products = {
    emas_batangan: [] as ReturnType<typeof logamMuliaOutputItem>[],
    perak_murni: [] as ReturnType<typeof logamMuliaOutputItem>[]
  };
  const debug: Record<string, { sectionFound: boolean; rowCount: number; inspectedRows: number; invalidRowsSkipped: number; stoppedAtSection: string | null }> = {};

  for (const sectionName of logamMuliaProductSections) {
    const parsed = extractLogamMuliaSectionRows(source, sectionName, fetched.html, visibleText);
    const slug = logamMuliaSectionSlugs[sectionName];
    products[slug] = parsed.rows.map(logamMuliaOutputItem);
    debug[slug] = {
      sectionFound: parsed.targetSectionFound,
      rowCount: parsed.rows.length,
      inspectedRows: parsed.inspectedRows,
      invalidRowsSkipped: parsed.invalidRowsSkipped,
      stoppedAtSection: parsed.stoppedAtSection
    };

    if (!parsed.targetSectionFound) {
      console.warn(`[scraper:logam-mulia] Section ${sectionName} tidak ditemukan. Melanjutkan section lain.`, {
        url,
        inspectedRows: parsed.inspectedRows
      });
    } else if (!parsed.rows.length) {
      console.warn(`[scraper:logam-mulia] Section ${sectionName} ditemukan, tetapi row harga valid kosong.`, {
        url,
        inspectedRows: parsed.inspectedRows,
        invalidRowsSkipped: parsed.invalidRowsSkipped,
        stoppedAtSection: parsed.stoppedAtSection
      });
    }
  }

  const totalRows = Object.values(products).reduce((total, rows) => total + rows.length, 0);
  if (!totalRows) {
    throw new Error("Semua section Logam Mulia kosong atau struktur HTML berubah.");
  }

  return {
    source: "logam_mulia" as const,
    scraped_at: nowIso(),
    products,
    debug
  };
}

export async function scrapeLogamMuliaEmasBatangan(url = "https://www.logammulia.com/id/harga-emas-hari-ini") {
  const result = await scrapeLogamMuliaProducts(url);
  if (!result.products.emas_batangan.length) throw new Error("Data harga Emas Batangan kosong atau struktur row berubah.");
  return {
    source: result.source,
    product_type: "emas_batangan" as const,
    scraped_at: result.scraped_at,
    items: result.products.emas_batangan
  };
}

async function runSingleSource(portal: Portal, jenisKonten: string, source: SourceConfig): Promise<GoldPriceSnapshot> {
  const base: Omit<GoldPriceSnapshot, "id" | "status" | "catatan"> = {
    portal,
    jenis_konten: jenisKonten,
    source_name: source.name,
    source_url: source.url,
    run_time: nowIso(),
    update_time: null,
    jenis_emas: inferJenisEmas(source, jenisKonten),
    berat: null,
    harga_terbaru: null,
    harga_kemarin: null,
    buyback: null,
    delta: null,
    percentage_change: null,
    tanggal_snapshot: todayJakarta(),
    price_rows: []
  };

  if (source.mode === "manual") {
    return {
      ...base,
      id: crypto.randomUUID(),
      status: "manual",
      catatan: source.operationalNote ?? `${source.name} sementara harus diisi manual oleh editor.`
    };
  }

  try {
    const lakuContext = isLakuEmasParser(source) ? await fetchLakuEmasPerhiasanContext(source, 3) : null;
    const fetched = lakuContext?.fetched ?? (await fetchHtml(source.url, 3));
    if (!fetched.ok || fetched.html.length < 200) {
      return {
        ...base,
        id: crypto.randomUUID(),
        status: "error",
        catatan: fetchFailureMessage(source.name, fetched)
      };
    }

    const htmlForParse = lakuContext?.html ?? fetched.html;
    const visibleText = lakuContext?.text ?? stripTags(htmlForParse);
    const text = `${visibleText} ${htmlForParse}`;
    const elementValid =
      source.elementKeywords.length === 0 || source.elementKeywords.some((keyword) => text.toLowerCase().includes(keyword.toLowerCase()));
    if (!elementValid) {
      return {
        ...base,
        id: crypto.randomUUID(),
        status: "error",
        catatan: `Data harga dari ${source.name} tidak dapat ditarik karena element sumber tidak ditemukan. Keyword dicek: ${source.elementKeywords.join(", ") || "-"}. HTML size: ${fetched.diagnostics.htmlSize}.`
      };
    }

    const rows = extractPriceRows(source, jenisKonten, htmlForParse, visibleText);
    if (!rows.length) {
      const rajaDebug = isRajaEmasParser(source) ? parseRajaEmasRows(source, htmlForParse, visibleText) : null;
      const logamDebug =
        source.parserType === "logam-mulia" || source.name === "Logam Mulia"
          ? parseLogamMuliaSections(source, jenisKonten, htmlForParse, visibleText)
          : null;
      const lakuDebug =
        isLakuEmasParser(source) && lakuContext
          ? parseLakuEmasRows(source, htmlForParse, visibleText, {
              activeTabDetected: lakuContext.activeTabDetected,
              parsedCategory: lakuContext.parsedCategory,
              ignoredCategories: lakuContext.ignoredCategories,
              endpointUrl: lakuContext.endpointUrl,
              sourceSelectorUsed: lakuContext.sourceSelectorUsed
            })
          : null;
      const lakuLandingNote =
        lakuContext && !lakuContext.landing.ok
          ? `Halaman utama gagal diakses (HTTP ${lakuContext.landing.status}).`
          : lakuContext && !lakuContext.categoriesDetected.includes("perhiasan")
            ? "Tab PERHIASAN tidak terdeteksi pada HTML halaman utama."
            : "";
      return {
        ...base,
        id: crypto.randomUUID(),
        status: "error",
        catatan: logamDebug
          ? `Data harga dari ${source.name} tidak dapat diparse. HTTP ${fetched.status}, HTML ${fetched.diagnostics.htmlSize} karakter, selector ${configuredRowSelector(source) ?? "-"}, section ditemukan: ${logamDebug.foundSections.join(", ") || "-"}, row valid: ${logamDebug.rows.length}, row di-skip: ${logamDebug.invalidRowsSkipped}.`
          : rajaDebug
            ? `Data harga dari ${source.name} tidak dapat diparse. HTTP ${fetched.status}, HTML ${fetched.diagnostics.htmlSize} karakter, selector ${rajaDebug.selectorUsed}, header tabel ditemukan: ${rajaDebug.headerFound ? "Ya" : "Tidak"}, row selector: ${rajaDebug.rowSelectionsCount}, row valid: ${rajaDebug.validRows}, text diabaikan: ${rajaDebug.ignoredTextCount}.`
            : lakuDebug
              ? `Data harga dari ${source.name} tidak dapat diparse. Endpoint ${lakuDebug.endpointUrl ?? "-"}, tab PERHIASAN: ${lakuDebug.activeTabDetected ? "aktif" : "tidak terdeteksi"}, kategori: ${lakuDebug.parsedCategory}, selector: ${lakuDebug.selectorUsed}, row selector: ${lakuDebug.rowSelectionsCount}, row valid: ${lakuDebug.validRows}, kategori diabaikan: ${lakuDebug.ignoredCategories.join(", ") || "-"}. ${lakuLandingNote}`.trim()
            : `Data harga dari ${source.name} tidak dapat diparse. HTTP ${fetched.status}, HTML ${fetched.diagnostics.htmlSize} karakter, selector ${configuredRowSelector(source) ?? "-"}.`
      };
    }

    const provisional: GoldPriceSnapshot = {
      ...base,
      id: crypto.randomUUID(),
      update_time: rows[0]?.waktu_update ?? findTimestamp(visibleText),
      price_rows: rows,
      status: "success",
      catatan: `Data harga ${source.name} berhasil diperbarui.`
    };

    const previous = await findPreviousSnapshot(provisional);
    provisional.price_rows = applyHistoricalComparison(rows, previous, source.priceCurrency);
    const primary = choosePrimaryRow(provisional.price_rows);
    const previousPrimary = previous?.price_rows.find((row) => primary && row.berat.toLowerCase() === primary.berat.toLowerCase());
    const comparison = formatDelta(primary?.harga ?? null, previousPrimary?.harga ?? null, source.priceCurrency);

    provisional.berat = primary?.berat ?? null;
    provisional.harga_terbaru = primary?.harga ?? null;
    provisional.harga_kemarin = previousPrimary?.harga ?? null;
    provisional.buyback = primary?.buyback ?? null;
    provisional.delta = comparison.delta;
    provisional.percentage_change = comparison.percentage;

    return provisional;
  } catch (error) {
    return {
      ...base,
      id: crypto.randomUUID(),
      status: "error",
      catatan: `Data harga dari ${source.name} tidak dapat ditarik karena kesalahan sistem: ${error instanceof Error ? `${error.name} - ${error.message}` : "unknown error"}.`
    };
  }
}

export async function previewSourceScrape(source: SourceConfig, jenisKonten = source.group === "perak" ? "Harga Perak" : "Harga Emas") {
  const selector = configuredRowSelector(source) || "";
  const previewedAt = nowIso();
  if (source.mode === "manual") {
    return {
      ok: false,
      selector,
      previewedAt,
      rowsFound: 0,
      validRows: 0,
      rows: [] as GoldPriceRow[],
      fetch: null,
      message: `${source.name} berstatus manual, tidak menjalankan scraping otomatis.`
    };
  }

  try {
    const lakuContext = isLakuEmasParser(source) ? await fetchLakuEmasPerhiasanContext(source) : null;
    const fetched = lakuContext?.fetched ?? (await fetchHtml(source.url));
    if (!fetched.ok || fetched.html.length < 200) {
      return {
        ok: false,
        selector,
        previewedAt,
        rowsFound: 0,
        validRows: 0,
        rows: [] as GoldPriceRow[],
        fetch: fetched.diagnostics,
        message: fetchFailureMessage(source.name, fetched)
      };
    }

    const htmlForParse = lakuContext?.html ?? fetched.html;
    const visibleText = lakuContext?.text ?? stripTags(htmlForParse);
    const candidateRows = selector ? tableRowsFromHtml(htmlForParse, selector).length : tableRowsFromHtml(htmlForParse).length;
    const rows = extractPriceRows(source, jenisKonten, htmlForParse, visibleText);
    const rajaEmasDebug = isRajaEmasParser(source) ? parseRajaEmasRows(source, htmlForParse, visibleText) : null;
    const logamMuliaDebug =
      source.parserType === "logam-mulia" || source.name === "Logam Mulia"
        ? parseLogamMuliaSections(source, jenisKonten, htmlForParse, visibleText)
        : null;
    const lakuDebug =
      isLakuEmasParser(source) && lakuContext
        ? parseLakuEmasRows(source, htmlForParse, visibleText, {
            activeTabDetected: lakuContext.activeTabDetected,
            parsedCategory: lakuContext.parsedCategory,
            ignoredCategories: lakuContext.ignoredCategories,
            endpointUrl: lakuContext.endpointUrl,
            sourceSelectorUsed: lakuContext.sourceSelectorUsed
          })
        : null;

    return {
      ok: rows.length > 0,
      selector,
      previewedAt,
      rowsFound: candidateRows,
      validRows: rows.length,
      rows: rows.slice(0, 20),
      fetch: fetched.diagnostics,
      debug: logamMuliaDebug
        ? {
            parser: "logam-mulia-section-based",
            sectionsFound: logamMuliaDebug.foundSections,
            ignoredSections: logamMuliaDebug.ignoredSections,
            validRows: logamMuliaDebug.rows.length,
            skippedRows: logamMuliaDebug.invalidRowsSkipped,
            skippedSamples: logamMuliaDebug.skippedRows,
            stoppedAtSection: logamMuliaDebug.stoppedAtSection,
            rawSelectorCount: candidateRows
          }
        : rajaEmasDebug
          ? {
              parser: "raja-emas-karat-table",
              validRows: rajaEmasDebug.validRows,
              skippedRows: rajaEmasDebug.skippedRows.length,
              skippedSamples: rajaEmasDebug.skippedRows.map((item) => ({
                section: "Harga Emas Perhiasan",
                reason: item.reason,
                sample: item.sample
              })),
              rawSelectorCount: rajaEmasDebug.rowSelectionsCount,
              ignoredTextCount: rajaEmasDebug.ignoredTextCount,
              headerFound: rajaEmasDebug.headerFound
            }
          : lakuDebug
            ? {
                parser: "laku-emas-perhiasan",
                validRows: lakuDebug.validRows,
                skippedRows: lakuDebug.skippedRows.length,
                skippedSamples: lakuDebug.skippedRows.map((item) => ({
                  section: lakuDebug.parsedCategory,
                  reason: item.reason,
                  sample: item.sample
                })),
                rawSelectorCount: lakuDebug.rowSelectionsCount,
                headerFound: lakuDebug.headerFound,
                activeTabDetected: lakuDebug.activeTabDetected,
                parsedCategory: lakuDebug.parsedCategory,
                ignoredCategories: lakuDebug.ignoredCategories,
                sourceSelectorUsed: lakuDebug.selectorUsed,
                endpointUrl: lakuDebug.endpointUrl
              }
          : undefined,
      message: rows.length
        ? `Preview menemukan ${rows.length} data valid dari ${candidateRows} row.`
        : `Selector berhasil dijalankan, tetapi tidak ada data harga valid dari ${candidateRows} row.`
    };
  } catch (error) {
    return {
      ok: false,
      selector,
      previewedAt,
      rowsFound: 0,
      validRows: 0,
      rows: [] as GoldPriceRow[],
      fetch: {
        ok: false,
        status: 0,
        finalUrl: source.url,
        htmlSize: 0,
        elapsedMs: 0,
        attempts: 0,
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage: error instanceof Error ? error.message : "Preview gagal karena kesalahan sistem."
      },
      debug: undefined,
      message: error instanceof Error ? `Preview gagal: ${error.message}` : "Preview gagal karena kesalahan sistem."
    };
  }
}

export async function validateSourceScrape(source: SourceConfig, jenisKonten = source.group === "perak" ? "Harga Perak" : "Harga Emas") {
  const selector = configuredRowSelector(source) || source.dataSelector?.trim() || "";
  const checkedAt = nowIso();
  const checks = {
    urlAccessible: false,
    selectorFound: false,
    rowFound: false,
    fieldMappingValid: false,
    dataParsed: false
  };
  const reasons: string[] = [];
  const recommendations: string[] = [];
  let elementCount = 0;
  let rowCount = 0;
  let validDataCount = 0;
  let sampleHtml = "";
  let sampleParsedRow: GoldPriceRow | null = null;
  let logamMuliaDebug: ReturnType<typeof parseLogamMuliaSections> | null = null;
  let rajaEmasDebug: ReturnType<typeof parseRajaEmasRows> | null = null;
  let lakuEmasDebug: ReturnType<typeof parseLakuEmasRows> | null = null;
  let fetchDiagnostics: FetchDiagnostics | null = null;
  let lakuContext: LakuEmasFetchContext | null = null;

  const invalidResult = () => ({
    ok: false,
    status: "INVALID" as const,
    selector,
    checkedAt,
    checks,
    reasons,
    recommendations,
    debug: {
      selector,
      fetch: fetchDiagnostics,
      elementCount,
      rowCount,
      validDataCount,
      sampleHtml,
      sampleParsedRow,
      sectionsFound: logamMuliaDebug?.foundSections ?? [],
      ignoredSections: logamMuliaDebug?.ignoredSections ?? [],
      skippedRows: logamMuliaDebug?.invalidRowsSkipped ?? 0,
      skippedSamples: logamMuliaDebug?.skippedRows ?? [],
      stoppedAtSection: logamMuliaDebug?.stoppedAtSection ?? null,
      rawSelectorCount: rajaEmasDebug?.rowSelectionsCount ?? rowCount,
      ignoredTextCount: rajaEmasDebug?.ignoredTextCount ?? 0,
      headerFound: rajaEmasDebug?.headerFound ?? false,
      activeTabDetected: lakuEmasDebug?.activeTabDetected ?? lakuContext?.activeTabDetected ?? false,
      parsedCategory: lakuEmasDebug?.parsedCategory ?? lakuContext?.parsedCategory ?? null,
      ignoredCategories: lakuEmasDebug?.ignoredCategories ?? lakuContext?.ignoredCategories ?? [],
      sourceSelectorUsed: lakuEmasDebug?.selectorUsed ?? lakuContext?.sourceSelectorUsed ?? selector,
      endpointUrl: lakuEmasDebug?.endpointUrl ?? lakuContext?.endpointUrl ?? null,
      checkedAt
    },
    rows: [] as GoldPriceRow[]
  });

  if (source.mode === "manual") {
    reasons.push(`${source.name} berstatus manual, validasi scraping otomatis tidak dijalankan.`);
    recommendations.push("Aktifkan mode otomatis jika source ini perlu divalidasi sebagai scraping source.");
    return invalidResult();
  }

  try {
    lakuContext = isLakuEmasParser(source) ? await fetchLakuEmasPerhiasanContext(source) : null;
    const fetched = lakuContext?.fetched ?? (await fetchHtml(source.url));
    const htmlForParse = lakuContext?.html ?? fetched.html;
    const textForParse = lakuContext?.text ?? stripTags(htmlForParse);
    fetchDiagnostics = fetched.diagnostics;
    checks.urlAccessible = lakuContext
      ? (lakuContext.landing.ok && lakuContext.landing.html.length >= 200) || (fetched.ok && htmlForParse.length >= 200)
      : fetched.ok && htmlForParse.length >= 200;

    if (!checks.urlAccessible) {
      reasons.push(fetchFailureMessage(source.name, lakuContext?.landing ?? fetched));
      recommendations.push("Periksa URL source, akses publik halaman, atau proteksi anti-bot dari website tujuan.");
      return invalidResult();
    }

    if (lakuContext && !lakuContext.activeTabDetected) {
      reasons.push("Tab PERHIASAN tidak terdeteksi pada halaman utama Laku Emas.");
      recommendations.push("Pastikan elemen tombol tab PERHIASAN masih memiliki id='perhiasan' dan onclick showPrice('perhiasan').");
    }

    let matchedElements: ReturnType<typeof queryHtmlSelections> = [];
    try {
      matchedElements = selector ? queryHtmlSelections(htmlForParse, selector) : queryHtmlSelections(htmlForParse, "tr");
    } catch (error) {
      reasons.push(`Selector tidak valid: ${error instanceof Error ? error.message : "format selector tidak dapat dibaca"}.`);
      recommendations.push("Gunakan CSS selector row yang langsung mengarah ke baris tabel, misalnya table.table-bordered tr.");
      return invalidResult();
    }

    elementCount = matchedElements.length;
    checks.selectorFound = elementCount > 0;
    sampleHtml = matchedElements[0]?.html?.slice(0, 1200) ?? "";

    try {
      rowCount = selector ? tableRowsFromHtml(htmlForParse, selector).length : tableRowsFromHtml(htmlForParse).length;
    } catch (error) {
      reasons.push(`Row tidak bisa dibaca dari selector: ${error instanceof Error ? error.message : "selector tidak dapat diproses"}.`);
      recommendations.push("Pastikan selector mengarah ke row tabel, bukan container besar atau elemen non-table.");
      return invalidResult();
    }

    checks.rowFound = rowCount > 0;

    const visibleText = textForParse;
    rajaEmasDebug = isRajaEmasParser(source) ? parseRajaEmasRows(source, htmlForParse, visibleText) : null;
    logamMuliaDebug =
      source.parserType === "logam-mulia" || source.name === "Logam Mulia"
        ? parseLogamMuliaSections(source, jenisKonten, htmlForParse, visibleText)
        : null;
    lakuEmasDebug =
      isLakuEmasParser(source) && lakuContext
        ? parseLakuEmasRows(source, htmlForParse, visibleText, {
            activeTabDetected: lakuContext.activeTabDetected,
            parsedCategory: lakuContext.parsedCategory,
            ignoredCategories: lakuContext.ignoredCategories,
            endpointUrl: lakuContext.endpointUrl,
            sourceSelectorUsed: lakuContext.sourceSelectorUsed
          })
        : null;
    const rows = logamMuliaDebug
      ? logamMuliaDebug.rows
      : rajaEmasDebug
        ? rajaEmasDebug.rows
        : lakuEmasDebug
          ? lakuEmasDebug.rows
          : extractPriceRows(source, jenisKonten, htmlForParse, visibleText);
    validDataCount = rows.length;
    checks.dataParsed = validDataCount > 0;
    sampleParsedRow = rows[0] ?? null;
    checks.fieldMappingValid = isRajaEmasParser(source)
      ? Boolean(sampleParsedRow?.weight && sampleParsedRow?.harga && isRajaKaratLabel(sampleParsedRow.weight ?? sampleParsedRow.berat))
      : isLakuEmasParser(source)
        ? Boolean(sampleParsedRow?.weight && sampleParsedRow?.harga && isLakuKadarLabel(sampleParsedRow.weight ?? sampleParsedRow.berat))
        : Boolean(
            sampleParsedRow?.weight &&
              typeof sampleParsedRow.base_price === "number" &&
              typeof sampleParsedRow.price_pph_025 === "number"
          );

    if (!checks.selectorFound) {
      reasons.push("Selector tidak menemukan element apa pun di halaman source.");
      recommendations.push("Coba selector yang lebih spesifik ke row tabel, misalnya table.table-bordered tr atau #priceList table tbody tr.");
    }
    if (!checks.rowFound) {
      reasons.push("Row tabel tidak ditemukan dari selector yang dipakai.");
      recommendations.push("Pastikan selector mengarah ke tr, bukan container besar atau section teks.");
    }
    if (!checks.fieldMappingValid) {
      reasons.push(
        isRajaEmasParser(source)
          ? "Field mapping Raja Emas belum sesuai. Dibutuhkan td[0] kadar_karat dan td[1] harga_per_gram."
          : isLakuEmasParser(source)
            ? "Field mapping Laku Emas belum sesuai. Dibutuhkan td[0] kadar dan td[1] harga_jual_per_gram dari tab PERHIASAN."
          : "Field mapping belum sesuai. Untuk Logam Mulia dibutuhkan td[0] berat, td[1] harga dasar, td[2] harga + Pajak PPh 0.25%."
      );
      recommendations.push(
        isRajaEmasParser(source)
          ? "Periksa mapping kolom Raja Emas: weightIndex=0, priceIndex=1, parserType=raja-emas."
          : isLakuEmasParser(source)
            ? "Periksa parserType=laku-emas, endpoint /harga-emas-fisik/brand/perhiasan, dan mapping kolom weightIndex=0, priceIndex=1."
          : "Periksa mapping kolom: weightIndex=0, basePriceIndex=1, pricePph025Index=2."
      );
    }
    if (!checks.dataParsed) {
      reasons.push(
        isRajaEmasParser(source)
          ? "Data Raja Emas belum berhasil diparse dari tabel Kadar Karat."
          : isLakuEmasParser(source)
            ? "Data Laku Emas belum berhasil diparse dari tabel PERHIASAN."
          : "Data harga belum berhasil diparse dari row yang ditemukan."
      );
      recommendations.push(
        isRajaEmasParser(source)
          ? "Gunakan row selector yang mengarah ke tabel di bawah judul 'Harga Beli Emas Hari Ini di Raja Emas Indonesia'."
          : isLakuEmasParser(source)
            ? "Pastikan parser membaca endpoint brand/perhiasan dan row selector mengarah ke table.table-bordered tbody tr."
          : "Pastikan row berada di section yang benar: Emas Batangan atau Perak Murni."
      );
    }

    const ok =
      checks.urlAccessible &&
      checks.selectorFound &&
      checks.rowFound &&
      checks.fieldMappingValid &&
      checks.dataParsed;

    return {
      ok,
      status: ok ? ("VALID" as const) : ("INVALID" as const),
      selector,
      checkedAt,
      checks,
      reasons,
      recommendations,
      debug: {
        selector,
        fetch: fetchDiagnostics,
        elementCount,
        rowCount,
        validDataCount,
        sampleHtml,
        sampleParsedRow,
        sectionsFound: logamMuliaDebug?.foundSections ?? [],
        ignoredSections: logamMuliaDebug?.ignoredSections ?? [],
        skippedRows: logamMuliaDebug?.invalidRowsSkipped ?? rajaEmasDebug?.skippedRows.length ?? lakuEmasDebug?.skippedRows.length ?? 0,
        skippedSamples:
          logamMuliaDebug?.skippedRows ??
          rajaEmasDebug?.skippedRows.map((item) => ({ section: "Harga Emas Perhiasan", reason: item.reason, sample: item.sample })) ??
          (lakuEmasDebug
            ? (() => {
                const parsedCategory = lakuEmasDebug.parsedCategory;
                return lakuEmasDebug.skippedRows.map((item) => ({ section: parsedCategory, reason: item.reason, sample: item.sample }));
              })()
            : undefined) ??
          [],
        stoppedAtSection: logamMuliaDebug?.stoppedAtSection ?? null,
        rawSelectorCount: rajaEmasDebug?.rowSelectionsCount ?? lakuEmasDebug?.rowSelectionsCount ?? rowCount,
        ignoredTextCount: rajaEmasDebug?.ignoredTextCount ?? 0,
        headerFound: rajaEmasDebug?.headerFound ?? lakuEmasDebug?.headerFound ?? false,
        activeTabDetected: lakuEmasDebug?.activeTabDetected ?? lakuContext?.activeTabDetected ?? false,
        parsedCategory: lakuEmasDebug?.parsedCategory ?? lakuContext?.parsedCategory ?? null,
        ignoredCategories: lakuEmasDebug?.ignoredCategories ?? lakuContext?.ignoredCategories ?? [],
        sourceSelectorUsed: lakuEmasDebug?.selectorUsed ?? lakuContext?.sourceSelectorUsed ?? selector,
        endpointUrl: lakuEmasDebug?.endpointUrl ?? lakuContext?.endpointUrl ?? null,
        checkedAt
      },
      rows: rows.slice(0, 40)
    };
  } catch (error) {
    reasons.push(error instanceof Error ? error.message : "Validasi source gagal karena kesalahan sistem.");
    recommendations.push("Ulangi preview scrape dan cek apakah URL/selector masih sesuai struktur website.");
    return invalidResult();
  }
}

export async function runData(portal: Portal, jenisKonten: string, selectedSources?: string[] | string | null) {
  const allSources = await getRuntimeSourcesForContent(portal, jenisKonten);
  const selectedList = Array.isArray(selectedSources)
    ? selectedSources.filter((source) => source && source !== "Semua Source")
    : selectedSources && selectedSources !== "Semua Source"
      ? [selectedSources]
      : [];
  const sources = selectedList.length ? allSources.filter((source) => selectedList.includes(source.name)) : allSources;
  if (!sources.length) {
    return {
      ok: false,
      portal,
      jenis_konten: jenisKonten,
      selected_source: selectedList[0] ?? null,
      selected_sources: selectedList,
      snapshots: [],
      source_views: [],
      notifications: [
        {
          id: crypto.randomUUID(),
          kind: "warning" as const,
          title: "Source belum tersedia",
          message: "Source yang dipilih belum aktif atau belum terhubung dengan portal ini."
        }
      ],
      partialFailure: false
    };
  }
  const snapshots = await Promise.all(sources.map((source) => runSingleSource(portal, jenisKonten, source)));
  await saveSnapshots(snapshots);

  const successful = snapshots.filter((snapshot) => snapshot.status === "success");
  const failed = snapshots.filter((snapshot) => snapshot.status === "error");
  const manual = snapshots.filter((snapshot) => snapshot.status === "manual");
  const notifications: DashboardNotification[] = [];

  if (successful.length) {
    notifications.push({
      id: crypto.randomUUID(),
      kind: "success",
      title: "RUN DATA berhasil",
      message: `Data harga berhasil diperbarui dari ${successful.length} source otomatis.`
    });
  }

  if (failed.length) {
    notifications.push({
      id: crypto.randomUUID(),
      kind: "error",
      title: "Sebagian source gagal",
      message: failed.map((item) => item.catatan).join(" ")
    });
  }

  if (manual.length) {
    notifications.push({
      id: crypto.randomUUID(),
      kind: "warning",
      title: "Source manual",
      message: `${manual.map((item) => item.source_name).join(", ")} sementara harus diisi manual oleh editor.`
    });
  }

  if (!successful.length) {
    notifications.push({
      id: crypto.randomUUID(),
      kind: "warning",
      title: "Data belum tersedia",
      message: "Generate artikel tidak dapat dilakukan karena data source belum berhasil dimuat."
    });
  }

  const partialFailure = failed.length > 0 || manual.length > 0;
  return {
    ok: successful.length > 0,
    portal,
    jenis_konten: jenisKonten,
    selected_source: selectedList[0] ?? null,
    selected_sources: selectedList.length ? selectedList : sources.map((source) => source.name),
    snapshots,
    source_views: buildSourceDataViews(snapshots),
    notifications,
    partialFailure,
    disclaimer: partialFailure ? "Sebagian source tidak berhasil dimuat. Artikel dibuat berdasarkan data yang tersedia." : undefined
  };
}
