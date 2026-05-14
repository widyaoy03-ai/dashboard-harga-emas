import { validateSourceScrape } from "./scraper";
import type { SourceConfig, SourceFieldMapping } from "./types";

const logamMuliaUrlPattern = /https?:\/\/(?:www\.)?logammulia\.com\/[^\s)]+/i;

function cleanText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function extractUrl(text: string) {
  return text.match(logamMuliaUrlPattern)?.[0] ?? text.match(/https?:\/\/[^\s)]+/i)?.[0] ?? "";
}

function hasWord(text: string, word: string) {
  return new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text);
}

function extractSections(text: string, fileName: string) {
  const candidates = ["Emas Batangan", "Perak Murni"];
  const sections = candidates.filter((section) => text.toLowerCase().includes(section.toLowerCase()));
  if (!sections.length && /perak/i.test(fileName)) return ["Perak Murni"];
  if (!sections.length) return ["Emas Batangan"];
  return sections;
}

function inferRowSelector(text: string) {
  const explicitSelector =
    text.match(/(?:selector|row selector|element data)\s*:?\s*([#.][^\n\r]+)/i)?.[1]?.trim() ??
    text.match(/((?:[#.][\w-]+|\w+)(?:[ >.#[\]\w='":-]+)?\s+tr)\b/i)?.[1]?.trim();

  if (explicitSelector && !explicitSelector.startsWith("<")) return explicitSelector;
  if (/<tr[\s>]/i.test(text)) return "table.table-bordered tr";
  return "tr";
}

function inferRequiredFields(text: string) {
  const fields = ["weight", "base_price", "price_pph_025"];
  const labels = {
    weight: hasWord(text, "Berat") ? "Berat" : "td[0]",
    base_price: /Harga\s+Dasar/i.test(text) ? "Harga Dasar" : "td[1]",
    price_pph_025: /PPh\s*0\.?25|Pajak|PPN\s*11/i.test(text) ? "Harga + Pajak PPh 0.25%" : "td[2]"
  };
  return { fields, labels };
}

export function parseSourceDocumentText(text: string, fileName = "source.docx") {
  const normalizedText = cleanText(text);
  const isPerak = /perak/i.test(`${fileName} ${normalizedText}`);
  const url = extractUrl(text);
  const sections = extractSections(normalizedText, fileName);
  const rowSelector = inferRowSelector(text);
  const requiredFields = inferRequiredFields(text);
  const fieldMapping: SourceFieldMapping = {
    weightIndex: 0,
    priceIndex: 1,
    basePriceIndex: 1,
    pricePph025Index: 2
  };

  const source: SourceConfig = {
    name: "Logam Mulia",
    url,
    mode: "otomatis",
    group: isPerak ? "perak" : "antam",
    selectorSummary: "Logam Mulia section table rows",
    parserType: "logam-mulia",
    dataSelector: "table.table-bordered",
    rowSelector,
    fieldMapping,
    elementKeywords: sections,
    includeKeywords: [],
    excludeKeywords: [],
    boundaryStartKeywords: sections,
    boundaryStopKeywords: isPerak
      ? ["Emas Batangan", "Gift Series", "Perak Heritage", "Heritage"]
      : ["Emas Batangan Gift Series", "Emas Batangan Selamat Idul Fitri", "Emas Batangan Imlek", "Emas Batangan Batik Seri III", "Perak", "Perak Murni", "Perak Heritage", "Heritage"],
    priceCurrency: "IDR",
    operationalNote: "Konfigurasi hasil ekstraksi dokumen source Logam Mulia."
  };

  return {
    sourceName: "Logam Mulia",
    fileName,
    url,
    rowSelector,
    parserType: "logam-mulia" as const,
    fieldMapping,
    requiredFields,
    sections,
    jenisKonten: isPerak ? "Harga Perak" : "Harga Emas",
    rawTextSample: text.slice(0, 1600),
    source,
    extractionNotes: [
      "Dokumen dipakai untuk mengekstrak URL, selector row, section, dan mapping kolom.",
      "Validasi tetap dilakukan ke website real karena struktur HTML bisa berubah."
    ]
  };
}

export async function auditSourceDocumentText(text: string, fileName = "source.docx") {
  const extraction = parseSourceDocumentText(text, fileName);

  if (!extraction.url) {
    return {
      ok: false,
      status: "INVALID" as const,
      extraction,
      validation: {
        ok: false,
        status: "INVALID" as const,
        selector: extraction.rowSelector,
        checkedAt: new Date().toISOString(),
        checks: {
          urlAccessible: false,
          selectorFound: false,
          rowFound: false,
          fieldMappingValid: false,
          dataParsed: false
        },
        reasons: ["URL source tidak ditemukan di dokumen Word."],
        recommendations: ["Tambahkan URL source Logam Mulia yang lengkap di dokumen source."],
        debug: {
          selector: extraction.rowSelector,
          elementCount: 0,
          rowCount: 0,
          validDataCount: 0,
          sampleHtml: "",
          sampleParsedRow: null,
          checkedAt: new Date().toISOString()
        },
        rows: []
      }
    };
  }

  const validation = await validateSourceScrape(extraction.source, extraction.jenisKonten);
  return {
    ok: validation.ok,
    status: validation.status,
    extraction,
    validation
  };
}
