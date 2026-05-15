import type { DashboardNotification, GenerateArticleResponse, GenerateMode, GeneratedArticle, GoldPriceRow, GoldPriceSnapshot, Portal } from "./types";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_OPENAI_MODEL = "gpt-4.1";
const MAX_ROWS_PER_SOURCE = 80;

type JsonPrimitive = string | number | boolean | null;
type JsonRecord = Record<string, JsonPrimitive | JsonPrimitive[] | Record<string, JsonPrimitive>>;

interface NormalizedSourceData {
  source_name: string;
  source_url: string;
  status: GoldPriceSnapshot["status"];
  jenis_emas: string;
  run_time: string;
  update_time: string | null;
  tanggal_snapshot: string;
  detected_shape: string[];
  row_count: number;
  rows: JsonRecord[];
}

interface ArticleGenerationContext {
  portal: Portal;
  portal_tone: string;
  content_label: string;
  generated_for_timezone: "Asia/Jakarta";
  partial_failure: boolean;
  failed_sources: Array<Pick<GoldPriceSnapshot, "source_name" | "source_url" | "status" | "catatan">>;
  source_data: NormalizedSourceData[];
  editorial_rules: string[];
}

interface OpenAIResponsePayload {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
  incomplete_details?: {
    reason?: string;
  };
}

const articleResponseSchema = {
  type: "object",
  properties: {
    headline: { type: "string" },
    lead: { type: "string" },
    body: {
      type: "array",
      items: { type: "string" }
    },
    sourceLinks: {
      type: "array",
      items: { type: "string" }
    },
    disclaimer: { type: "string" }
  },
  required: ["headline", "lead", "body", "sourceLinks", "disclaimer"],
  additionalProperties: false
} as const;

function notification(kind: DashboardNotification["kind"], title: string, message: string): DashboardNotification {
  return {
    id: crypto.randomUUID(),
    kind,
    title,
    message
  };
}

function portalTone(portal: Portal) {
  if (portal === "Beritasatu") {
    return "Bahasa Indonesia newsroom style: cepat, lugas, langsung ke data utama, paragraf pendek, tidak bertele-tele.";
  }

  return "Bahasa Indonesia business-news style: lebih analitis, memberi konteks market secukupnya, tetap disiplin pada data dan tidak mengarang angka.";
}

function compactText(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed || null;
}

function isPriceLikeRow(row: GoldPriceRow) {
  return Boolean(
    compactText(row.harga) ||
      compactText(row.buyback) ||
      row.base_price !== null ||
      row.base_price !== undefined ||
      row.price_pph_025 !== null ||
      row.price_pph_025 !== undefined
  );
}

function isUsableSnapshot(snapshot: GoldPriceSnapshot) {
  if (snapshot.status !== "success") return false;

  return Boolean(
    compactText(snapshot.harga_terbaru) ||
      compactText(snapshot.harga_kemarin) ||
      compactText(snapshot.delta) ||
      compactText(snapshot.percentage_change) ||
      snapshot.price_rows.some(isPriceLikeRow)
  );
}

function putIfPresent(target: JsonRecord, key: string, value: JsonPrimitive | undefined) {
  if (value === undefined || value === null) return;
  if (typeof value === "string") {
    const cleaned = compactText(value);
    if (cleaned) target[key] = cleaned;
    return;
  }
  target[key] = value;
}

function normalizeRow(row: GoldPriceRow): JsonRecord {
  const normalized: JsonRecord = {};

  putIfPresent(normalized, "product_type", row.product_type);
  putIfPresent(normalized, "category", row.category ?? row.section_name);
  putIfPresent(normalized, "weight", row.weight ?? row.berat);
  putIfPresent(normalized, "price_display", row.harga);
  putIfPresent(normalized, "base_price", row.base_price);
  putIfPresent(normalized, "price_pph_025", row.price_pph_025);
  putIfPresent(normalized, "buyback", row.buyback);
  putIfPresent(normalized, "delta", row.delta);
  putIfPresent(normalized, "percentage_change", row.percentage_change);
  putIfPresent(normalized, "waktu_update", row.waktu_update);
  putIfPresent(normalized, "tanggal_update", row.tanggal_update);
  putIfPresent(normalized, "previous_snapshot_date", row.previous_snapshot_date);
  putIfPresent(normalized, "previous_snapshot_run_time", row.previous_snapshot_run_time);

  return normalized;
}

function snapshotSummaryRow(snapshot: GoldPriceSnapshot): JsonRecord {
  const summary: JsonRecord = {};
  putIfPresent(summary, "metric", "snapshot_summary");
  putIfPresent(summary, "jenis_emas", snapshot.jenis_emas);
  putIfPresent(summary, "weight", snapshot.berat);
  putIfPresent(summary, "latest_price", snapshot.harga_terbaru);
  putIfPresent(summary, "previous_price", snapshot.harga_kemarin);
  putIfPresent(summary, "buyback", snapshot.buyback);
  putIfPresent(summary, "delta", snapshot.delta);
  putIfPresent(summary, "percentage_change", snapshot.percentage_change);
  putIfPresent(summary, "update_time", snapshot.update_time);
  return summary;
}

function inferShape(rows: JsonRecord[]) {
  const keys = new Set<string>();
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (value !== null && value !== "") keys.add(key);
    }
  }
  return Array.from(keys);
}

function normalizeSourceData(snapshots: GoldPriceSnapshot[]): NormalizedSourceData[] {
  return snapshots.map((snapshot) => {
    const sourceRows = snapshot.price_rows.filter(isPriceLikeRow).map(normalizeRow);
    const rows = sourceRows.length > 0 ? sourceRows : [snapshotSummaryRow(snapshot)];
    const limitedRows = rows.slice(0, MAX_ROWS_PER_SOURCE);

    return {
      source_name: snapshot.source_name,
      source_url: snapshot.source_url,
      status: snapshot.status,
      jenis_emas: snapshot.jenis_emas,
      run_time: snapshot.run_time,
      update_time: snapshot.update_time,
      tanggal_snapshot: snapshot.tanggal_snapshot,
      detected_shape: inferShape(limitedRows),
      row_count: rows.length,
      rows: limitedRows
    };
  });
}

function buildContext(portal: Portal, jenisKonten: string, usableSnapshots: GoldPriceSnapshot[], allSnapshots: GoldPriceSnapshot[]): ArticleGenerationContext {
  const failedSources = allSnapshots
    .filter((snapshot) => snapshot.status !== "success")
    .map((snapshot) => ({
      source_name: snapshot.source_name,
      source_url: snapshot.source_url,
      status: snapshot.status,
      catatan: snapshot.catatan
    }));

  return {
    portal,
    portal_tone: portalTone(portal),
    content_label: jenisKonten,
    generated_for_timezone: "Asia/Jakarta",
    partial_failure: failedSources.length > 0,
    failed_sources: failedSources,
    source_data: normalizeSourceData(usableSnapshots),
    editorial_rules: [
      "Gunakan source_data dan bentuk datanya sebagai konteks utama artikel.",
      "Portal hanya menentukan tone dan writing style; jangan pakai portal untuk memilih template statis.",
      "content_label hanya metadata redaksi; jangan gunakan sebagai routing template hardcoded.",
      "Jangan mengarang angka, harga, timestamp, sumber, atau perbandingan yang tidak ada di data.",
      "Jika data menyediakan delta atau previous snapshot, jelaskan perbandingan secara transparan.",
      "Jika beberapa source berhasil dan sebagian gagal, artikel tetap dibuat berdasarkan data yang tersedia dan disclaimer harus menyebut sebagian source gagal.",
      "Tulis headline yang natural untuk portal, lead yang kuat, dan body 4 sampai 7 paragraf ringkas.",
      "Jika data berbentuk tabel harga per berat/kadar, tampilkan rincian penting dalam body dengan bullet list pendek.",
      "Market insight boleh ditambahkan singkat, umum, dan tidak boleh menyebut data eksternal spesifik yang tidak tersedia."
    ]
  };
}

function developerPrompt() {
  return [
    "Kamu adalah engine penulisan artikel redaksi ekonomi untuk dashboard harga emas dan perak.",
    "Tugasmu membuat draft artikel Bahasa Indonesia dari normalized source data yang diberikan sistem.",
    "Jangan memakai template picker manual, jangan memakai routing template hardcoded, dan jangan meniru histori artikel secara bebas.",
    "Pahami nama source, schema field, row data, delta, timestamp, dan status data. Bentuk data source menentukan struktur artikel.",
    "Portal hanya menentukan tone: Beritasatu lebih straight-news dan ringkas; Investor Daily lebih bisnis dan analitis.",
    "Output wajib JSON valid sesuai schema. Jangan tambahkan markdown fence atau teks di luar JSON."
  ].join("\n");
}

function userPrompt(context: ArticleGenerationContext) {
  return [
    "Buat draft artikel dari konteks JSON berikut.",
    "Pastikan semua angka artikel berasal dari source_data.",
    "Jika sourceLinks berisi link, hanya gunakan URL yang ada di source_data.",
    "Konteks:",
    JSON.stringify(context, null, 2)
  ].join("\n");
}

function extractOutputText(payload: OpenAIResponsePayload) {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
  }

  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if ((content.type === "output_text" || content.type === "text") && typeof content.text === "string" && content.text.trim()) {
        return content.text;
      }
    }
  }

  return null;
}

function isGeneratedArticle(value: unknown): value is GeneratedArticle & { disclaimer: string } {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<GeneratedArticle>;
  return (
    typeof candidate.headline === "string" &&
    typeof candidate.lead === "string" &&
    Array.isArray(candidate.body) &&
    candidate.body.every((paragraph) => typeof paragraph === "string") &&
    Array.isArray(candidate.sourceLinks) &&
    candidate.sourceLinks.every((link) => typeof link === "string") &&
    typeof candidate.disclaimer === "string"
  );
}

function sanitizeArticle(article: GeneratedArticle & { disclaimer: string }, context: ArticleGenerationContext): GeneratedArticle {
  const allowedLinks = new Set(context.source_data.map((source) => source.source_url));
  const sourceLinks = article.sourceLinks.filter((link) => allowedLinks.has(link));
  const fallbackLinks = context.source_data.map((source) => source.source_url);
  const body = article.body.map((paragraph) => paragraph.trim()).filter(Boolean);
  const disclaimer =
    article.disclaimer.trim() ||
    (context.partial_failure ? "Sebagian source tidak berhasil dimuat. Artikel dibuat berdasarkan data yang tersedia." : undefined);

  return {
    headline: article.headline.trim(),
    lead: article.lead.trim(),
    body,
    sourceLinks: sourceLinks.length > 0 ? sourceLinks : fallbackLinks,
    disclaimer
  };
}

function valueAsText(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return compactText(value);
  return null;
}

function valueAsNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const numeric = Number(value.replace(/[^\d.-]/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function formatRupiah(value: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0
  })
    .format(value)
    .replace(/\s/g, "");
}

function formatTemplatePrice(row: JsonRecord) {
  const pricePph = valueAsNumber(row.price_pph_025);
  const basePrice = valueAsNumber(row.base_price);
  const displayPrice = valueAsText(row.price_display);
  const buyback = valueAsText(row.buyback);

  if (basePrice !== null && pricePph !== null) {
    return `${formatRupiah(basePrice)} harga dasar, ${formatRupiah(pricePph)} termasuk PPh 0,25%`;
  }

  if (pricePph !== null) return formatRupiah(pricePph);
  if (basePrice !== null) return formatRupiah(basePrice);
  if (displayPrice) return displayPrice;
  if (buyback) return buyback;
  return "data harga tersedia";
}

function rowLabel(row: JsonRecord) {
  return (
    valueAsText(row.weight) ??
    valueAsText(row.category) ??
    valueAsText(row.product_type) ??
    valueAsText(row.jenis_emas) ??
    valueAsText(row.metric) ??
    "Harga"
  );
}

function representativeRow(source: NormalizedSourceData) {
  return (
    source.rows.find((row) => /(^|\s)1\s*(gr|gram|g)\b/i.test(rowLabel(row))) ??
    source.rows.find((row) => valueAsText(row.weight)) ??
    source.rows[0] ??
    {}
  );
}

function movementFromContext(context: ArticleGenerationContext) {
  const deltas = context.source_data.flatMap((source) => source.rows.map((row) => valueAsText(row.delta)).filter(Boolean) as string[]);
  const firstDelta = deltas[0];
  if (!firstDelta) return "bergerak stabil";
  if (firstDelta.trim().startsWith("-")) return `turun ${firstDelta.replace(/^-/, "")}`;
  if (firstDelta.includes("+") || /naik/i.test(firstDelta)) return `naik ${firstDelta.replace(/^\+/, "")}`;
  return `berubah ${firstDelta}`;
}

function snapshotDate(context: ArticleGenerationContext) {
  const dateValue = context.source_data[0]?.tanggal_snapshot;
  const date = dateValue ? new Date(dateValue) : new Date();
  if (Number.isNaN(date.getTime())) return dateValue ?? "hari ini";
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "long",
    timeZone: "Asia/Jakarta"
  }).format(date);
}

function sourceNames(context: ArticleGenerationContext) {
  return context.source_data.map((source) => source.source_name).join(", ");
}

function sourceBulletBlock(source: NormalizedSourceData) {
  const rows = source.rows.slice(0, 8);
  if (!rows.length) return `${source.source_name}:\n- Data harga tersedia`;
  const bullets = rows.map((row) => `- ${rowLabel(row)}: ${formatTemplatePrice(row)}`);
  return `${source.source_name}:\n${bullets.join("\n")}`;
}

function commodityLabel(context: ArticleGenerationContext) {
  const combined = context.source_data
    .flatMap((source) => [source.jenis_emas, ...source.rows.map((row) => valueAsText(row.category) ?? valueAsText(row.product_type) ?? "")])
    .join(" ")
    .toLowerCase();

  if (combined.includes("perak") && combined.includes("emas")) return "emas dan perak";
  if (combined.includes("perak")) return "perak";
  return "emas";
}

function buildTemplateArticle(context: ArticleGenerationContext): GeneratedArticle {
  const date = snapshotDate(context);
  const sources = sourceNames(context);
  const primarySource = context.source_data[0];
  const primaryRow = representativeRow(primarySource);
  const primaryLabel = rowLabel(primaryRow);
  const primaryPrice = formatTemplatePrice(primaryRow);
  const commodity = commodityLabel(context);
  const movement = movementFromContext(context);
  const sourceBlocks = context.source_data.map(sourceBulletBlock).join("\n\n");
  const updateTime = primarySource.update_time ?? primarySource.run_time;
  const sourceLinks = [...new Set(context.source_data.map((source) => source.source_url))];
  const disclaimer = context.partial_failure ? "Sebagian source tidak berhasil dimuat. Artikel dibuat berdasarkan data yang tersedia." : undefined;

  if (context.portal === "Beritasatu") {
    return {
      headline: `Harga ${commodity} ${primarySource.source_name} Hari Ini: ${primaryLabel} ${primaryPrice}`,
      lead: `Harga ${commodity} dari ${primarySource.source_name} pada ${date} tercatat ${movement}. Data utama menunjukkan ${primaryLabel} berada di level ${primaryPrice}.`,
      body: [
        `Data harga dihimpun dari ${sources}. Pembaruan source terakhir tercatat pada ${updateTime}.`,
        `Berikut rincian harga yang tersedia:\n${sourceBlocks}`,
        `Pergerakan harga ${commodity} masih dipengaruhi kondisi pasar global, perubahan nilai tukar, dan dinamika permintaan logam mulia.`,
        `Editor tetap dapat meninjau kembali detail source sebelum artikel dipublikasikan.`
      ],
      sourceLinks,
      disclaimer
    };
  }

  return {
    headline: `Harga ${commodity} ${primarySource.source_name} Bergerak ${movement} pada ${date}`,
    lead: `Harga ${commodity} dari ${primarySource.source_name} pada perdagangan ${date} tercatat ${movement}, dengan ${primaryLabel} berada di level ${primaryPrice}.`,
    body: [
      `Pergerakan harga ${commodity} masih menjadi perhatian pasar seiring dinamika dolar AS, ekspektasi suku bunga, dan permintaan aset lindung nilai.`,
      `Dashboard menghimpun data dari ${sources}. Pembaruan source utama tercatat pada ${updateTime}.`,
      `Berikut rincian harga yang tersedia:\n${sourceBlocks}`,
      `Secara umum, perubahan harga perlu dibaca bersama histori snapshot sebelumnya agar editor dapat melihat arah pergerakan dan konsistensi data antar source.`,
      `Harga ${commodity} berpotensi tetap fluktuatif mengikuti perkembangan pasar global dan sentimen ekonomi terbaru.`
    ],
    sourceLinks,
    disclaimer
  };
}

async function callOpenAI(context: ArticleGenerationContext): Promise<GeneratedArticle> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY belum tersedia di environment server.");
  }

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
      input: [
        {
          role: "developer",
          content: developerPrompt()
        },
        {
          role: "user",
          content: userPrompt(context)
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "editorial_gold_article",
          schema: articleResponseSchema,
          strict: true
        }
      },
      max_output_tokens: 2400,
      store: false
    })
  });

  const payload = (await response.json().catch(() => ({}))) as OpenAIResponsePayload;
  if (!response.ok) {
    const message = payload.error?.message ?? `OpenAI API mengembalikan HTTP ${response.status}.`;
    throw new Error(message);
  }

  if (payload.error?.message) {
    throw new Error(payload.error.message);
  }

  if (payload.incomplete_details?.reason) {
    throw new Error(`Respons AI tidak lengkap: ${payload.incomplete_details.reason}.`);
  }

  const outputText = extractOutputText(payload);
  if (!outputText) {
    throw new Error("Respons AI kosong atau tidak berisi output_text.");
  }

  const parsed = JSON.parse(outputText) as unknown;
  if (!isGeneratedArticle(parsed)) {
    throw new Error("Respons AI tidak sesuai format draft artikel.");
  }

  return sanitizeArticle(parsed, context);
}

export async function generateArticle(
  portal: Portal,
  jenisKonten: string,
  snapshots: GoldPriceSnapshot[],
  mode: GenerateMode = "template"
): Promise<GenerateArticleResponse> {
  const usableSnapshots = snapshots.filter(isUsableSnapshot);

  if (!portal || usableSnapshots.length === 0) {
    return {
      ok: false,
      mode,
      notifications: [
        notification(
          "warning",
          "Generate artikel belum siap",
          "Generate artikel tidak dapat dilakukan karena data source belum berhasil dimuat."
        )
      ]
    };
  }

  const context = buildContext(portal, jenisKonten, usableSnapshots, snapshots);

  if (mode === "template") {
    const article = buildTemplateArticle(context);
    return {
      ok: true,
      mode,
      article,
      notifications: [
        notification(
          context.partial_failure ? "warning" : "success",
          context.partial_failure ? "Draft template dibuat dengan data terbatas" : "Draft template berhasil dibuat",
          context.partial_failure
            ? "Sebagian source gagal dimuat. Draft template dibuat berdasarkan source yang berhasil."
            : "Draft artikel dibuat dengan Template Mode tanpa OpenAI API."
        )
      ]
    };
  }

  try {
    const article = await callOpenAI(context);
    return {
      ok: true,
      mode,
      article,
      notifications: [
        notification(
          context.partial_failure ? "warning" : "success",
          context.partial_failure ? "Artikel AI dibuat dengan data terbatas" : "Artikel AI berhasil dibuat",
          context.partial_failure
            ? "Sebagian source gagal dimuat. Draft dibuat oleh OpenAI berdasarkan source yang berhasil."
            : "Draft artikel dibuat oleh OpenAI berdasarkan snapshot data terbaru."
        )
      ]
    };
  } catch (error) {
    return {
      ok: false,
      mode,
      notifications: [
        notification(
          "warning",
          "AI generation belum tersedia",
          error instanceof Error
            ? `${error.message} Silakan gunakan Generate with Template sementara.`
            : "AI generation belum tersedia. Silakan gunakan Generate with Template sementara."
        )
      ]
    };
  }
}
