import { getRuntimeSourcesForContent } from "./admin-storage";
import { findPreviousSnapshot, saveSnapshots } from "./storage";
import type { DashboardNotification, GoldPriceRow, GoldPriceSnapshot, Portal, SourceConfig } from "./types";

const userAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

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

function scopedHtmlForSelector(html: string, selector?: string) {
  if (!selector) return html;
  const tableClass = selector.match(/table\.([a-z0-9_-]+)/i)?.[1];
  if (!tableClass) return html;

  const tablePattern = /<table\b[^>]*>[\s\S]*?<\/table>/gi;
  const matchedTables = [...html.matchAll(tablePattern)]
    .map((match) => match[0])
    .filter((tableHtml) => new RegExp(`class=["'][^"']*\\b${tableClass}\\b`, "i").test(tableHtml));

  return matchedTables.length ? matchedTables.join("\n") : html;
}

function tableRowsFromHtml(html: string, selector?: string) {
  const rows: string[][] = [];
  const cleanHtml = scopedHtmlForSelector(html, selector).replace(/<!--[\s\S]*?-->/g, " ");
  for (const rowMatch of cleanHtml.matchAll(/<tr[\s\S]*?<\/tr>/gi)) {
    const rowHtml = rowMatch[0];
    const cells = [...rowHtml.matchAll(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)]
      .map((match) => htmlCellText(match[1]))
      .filter(Boolean);
    if (cells.length) rows.push(cells);
  }
  return rows;
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
  sectionName?: string | null
): GoldPriceRow {
  return {
    id: crypto.randomUUID(),
    source_name: source.name,
    source_url: source.url,
    jenis_emas: jenisEmas,
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

  const weightCellIndex = cells.findIndex((cell) => looksLikeWeight(cell));
  if (weightCellIndex < 0) return null;

  const berat = normalizeWeight(cells[weightCellIndex]);
  const priceCells = cells.slice(weightCellIndex + 1).length ? cells.slice(weightCellIndex + 1) : cells;
  const prices = priceCells
    .map((cell) => cleanPrice(cell, source.priceCurrency))
    .filter(Boolean) as string[];

  if (!prices.length) return null;
  return createPriceRow(source, jenisEmas, berat, prices[0] ?? null, null, updateTime, sectionName);
}

function rowsFromHtmlTables(source: SourceConfig, jenisEmas: string, html: string, updateTime: string | null) {
  const rows: GoldPriceRow[] = [];
  const tableRows = tableRowsFromHtml(html, source.rowSelector || source.dataSelector);
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

const logamMuliaSections = ["Emas Batangan", "Gift Series", "Perak Murni", "Perak Heritage", "Perak", "Heritage"];

function findLogamMuliaSection(rowText: string) {
  const normalized = rowText.replace(/\s+/g, " ").trim();
  return logamMuliaSections.find((section) => new RegExp(`\\b${section}\\b`, "i").test(normalized)) ?? null;
}

function rowsFromLogamMuliaSections(source: SourceConfig, jenisKonten: string, html: string, text: string) {
  const updateTime = findTimestamp(text);
  const isPerak = jenisKonten.toLowerCase().includes("perak");
  const targetSections = isPerak ? ["Perak Murni", "Perak Heritage"] : ["Emas Batangan"];
  const rows: GoldPriceRow[] = [];
  let activeSection: string | null = null;

  for (const cells of tableRowsFromHtml(html, source.rowSelector || source.dataSelector)) {
    const rowText = cells.join(" ");
    const sectionHeading = findLogamMuliaSection(rowText);

    if (sectionHeading) {
      activeSection = targetSections.includes(sectionHeading) ? sectionHeading : null;
      continue;
    }

    if (!activeSection) continue;
    if (!/\bRp\.?\s*\d/i.test(rowText)) continue;

    const row = priceRowFromCells(source, activeSection, cells, updateTime, activeSection);
    if (row) rows.push(row);
  }

  return dedupeRows(rows).slice(0, 80);
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
    const key = `${row.source_name}|${row.berat}|${row.harga}|${row.buyback}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return Boolean(row.harga || row.buyback);
  });
}

function extractPriceRows(source: SourceConfig, jenisKonten: string, html: string, text: string) {
  const jenisEmas = inferJenisEmas(source, jenisKonten);
  const updateTime = findTimestamp(text);

  if (source.name === "Logam Mulia") {
    return rowsFromLogamMuliaSections(source, jenisKonten, html, text);
  }

  if (source.priceCurrency === "USD") {
    const prices = priceCandidates(text, "USD");
    return prices.length ? [createPriceRow(source, jenisEmas, "1 ons troi", prices[0], null, updateTime)] : [];
  }

  const tableRows = rowsFromHtmlTables(source, jenisEmas, html, updateTime);
  const textRows = rowsFromTextLines(source, jenisEmas, text, updateTime);
  const rows = dedupeRows([...tableRows, ...textRows]);

  if (rows.length) return rows.slice(0, 80);

  const fallbackPrices = priceCandidates(text, source.priceCurrency);
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

async function fetchHtml(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": userAgent,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7"
      },
      redirect: "follow",
      signal: controller.signal,
      cache: "no-store"
    });

    const html = await response.text();
    return { ok: response.ok, status: response.status, finalUrl: response.url, html };
  } finally {
    clearTimeout(timeout);
  }
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
    const fetched = await fetchHtml(source.url);
    if (!fetched.ok || fetched.html.length < 200) {
      return {
        ...base,
        id: crypto.randomUUID(),
        status: "error",
        catatan: `Source ${source.name} sedang tidak dapat diakses. Silakan coba beberapa saat lagi.`
      };
    }

    const visibleText = stripTags(fetched.html);
    const text = `${visibleText} ${fetched.html}`;
    const elementValid =
      source.elementKeywords.length === 0 || source.elementKeywords.some((keyword) => text.toLowerCase().includes(keyword.toLowerCase()));
    if (!elementValid) {
      return {
        ...base,
        id: crypto.randomUUID(),
        status: "error",
        catatan: `Data harga dari ${source.name} tidak dapat ditarik karena element sumber tidak ditemukan.`
      };
    }

    const rows = extractPriceRows(source, jenisKonten, fetched.html, visibleText);
    if (!rows.length) {
      return {
        ...base,
        id: crypto.randomUUID(),
        status: "error",
        catatan: `Data harga dari ${source.name} tidak dapat ditarik karena kesalahan sistem.`
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
  } catch {
    return {
      ...base,
      id: crypto.randomUUID(),
      status: "error",
      catatan: `Data harga dari ${source.name} tidak dapat ditarik karena kesalahan sistem.`
    };
  }
}

export async function previewSourceScrape(source: SourceConfig, jenisKonten = source.group === "perak" ? "Harga Perak" : "Harga Emas") {
  if (source.mode === "manual") {
    return {
      ok: false,
      selector: source.rowSelector || source.dataSelector || "",
      rowsFound: 0,
      rows: [] as GoldPriceRow[],
      message: `${source.name} berstatus manual, tidak menjalankan scraping otomatis.`
    };
  }

  const fetched = await fetchHtml(source.url);
  const visibleText = stripTags(fetched.html);
  const rows = fetched.ok ? extractPriceRows(source, jenisKonten, fetched.html, visibleText) : [];

  return {
    ok: fetched.ok && rows.length > 0,
    selector: source.rowSelector || source.dataSelector || "",
    rowsFound: rows.length,
    rows: rows.slice(0, 20),
    message: fetched.ok ? `Preview menemukan ${rows.length} row harga.` : `Source merespons HTTP ${fetched.status}.`
  };
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
      notifications: [
        {
          id: crypto.randomUUID(),
          kind: "warning" as const,
          title: "Source belum tersedia",
          message: "Source yang dipilih belum terhubung dengan jenis konten ini."
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
    notifications,
    partialFailure,
    disclaimer: partialFailure ? "Sebagian source tidak berhasil dimuat. Artikel dibuat berdasarkan data yang tersedia." : undefined
  };
}
