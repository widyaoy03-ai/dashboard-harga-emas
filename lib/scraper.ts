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

function tableRowsFromHtml(html: string) {
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
  updateTime: string | null
): GoldPriceRow {
  return {
    id: crypto.randomUUID(),
    source_name: source.name,
    source_url: source.url,
    jenis_emas: jenisEmas,
    berat,
    harga,
    buyback,
    waktu_update: updateTime,
    tanggal_update: updateTime,
    delta: null,
    percentage_change: null
  };
}

function rowsFromHtmlTables(source: SourceConfig, jenisEmas: string, html: string, updateTime: string | null) {
  const rows: GoldPriceRow[] = [];
  const tableRows = tableRowsFromHtml(html);

  for (const cells of tableRows) {
    const weightCellIndex = cells.findIndex((cell) => looksLikeWeight(cell));
    if (weightCellIndex < 0) continue;

    const berat = normalizeWeight(cells[weightCellIndex]);
    const prices = cells
      .slice(weightCellIndex + 1)
      .map((cell) => cleanPrice(cell, source.priceCurrency))
      .filter(Boolean) as string[];

    if (!prices.length) continue;
    const buyback = ["Emas Kita", "Laku Emas", "Indogold", "ShariaCoin", "BSI"].includes(source.name) ? prices[1] ?? null : null;
    rows.push(createPriceRow(source, jenisEmas, berat, prices[0] ?? null, buyback, updateTime));
  }

  return rows;
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
    rows.push(createPriceRow(source, jenisEmas, normalizeWeight(line), prices[0] ?? null, prices[1] ?? null, updateTime));
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

  if (source.priceCurrency === "USD") {
    const prices = priceCandidates(text, "USD");
    return prices.length ? [createPriceRow(source, jenisEmas, "1 ons troi", prices[0], null, updateTime)] : [];
  }

  const tableRows = rowsFromHtmlTables(source, jenisEmas, html, updateTime);
  const textRows = rowsFromTextLines(source, jenisEmas, text, updateTime);
  const rows = dedupeRows([...tableRows, ...textRows]);

  if (rows.length) return rows.slice(0, 80);

  const fallbackPrices = priceCandidates(text, source.priceCurrency);
  return fallbackPrices.length ? [createPriceRow(source, jenisEmas, "Satuan utama", fallbackPrices[0], fallbackPrices[1] ?? null, updateTime)] : [];
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
      percentage_change: comparison.percentage
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
    const elementValid = source.elementKeywords.some((keyword) => text.toLowerCase().includes(keyword.toLowerCase()));
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

export async function runData(portal: Portal, jenisKonten: string) {
  const sources = await getRuntimeSourcesForContent(portal, jenisKonten);
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
    snapshots,
    notifications,
    partialFailure,
    disclaimer: partialFailure ? "Sebagian source tidak berhasil dimuat. Artikel dibuat berdasarkan data yang tersedia." : undefined
  };
}
