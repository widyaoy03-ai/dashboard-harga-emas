import { getRuntimeArticleTemplate } from "./admin-storage";
import { chooseTemplateProfile } from "./editorial-templates";
import type { ArticleTemplateRecord, DashboardNotification, GeneratedArticle, GoldPriceRow, GoldPriceSnapshot, Portal } from "./types";

function portalDateline(portal: Portal) {
  return portal === "Beritasatu" ? "Jakarta, Beritasatu.com" : "JAKARTA, investor.id";
}

function todayLabel() {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(new Date());
}

function movementFromDelta(delta?: string | null) {
  if (!delta) return "stabil";
  if (delta.startsWith("+")) return "naik";
  if (delta.startsWith("-")) return "turun";
  return "stabil";
}

function strongestMovement(snapshots: GoldPriceSnapshot[]) {
  const withDelta = snapshots.find((snapshot) => snapshot.delta);
  return movementFromDelta(withDelta?.delta);
}

function movementWordForHeadline(portal: Portal, movement: string) {
  if (portal === "Beritasatu") {
    if (movement === "naik") return "Menguat";
    if (movement === "turun") return "Turun";
    return "Stabil";
  }
  if (movement === "naik") return "Melonjak";
  if (movement === "turun") return "Tertekan";
  return "Cermati Rinciannya";
}

function sourceNames(snapshots: GoldPriceSnapshot[]) {
  return [...new Set(snapshots.map((snapshot) => snapshot.source_name))].join(", ");
}

function renderTemplateText(template: string, portal: Portal, jenisKonten: string, snapshots: GoldPriceSnapshot[]) {
  const first = snapshots[0];
  const date = todayLabel();
  const movement = strongestMovement(snapshots);
  const movementHeadline = movementWordForHeadline(portal, movement);
  const replacements: Record<string, string> = {
    portal,
    dateline: portalDateline(portal),
    jenis_konten: jenisKonten,
    "jenis konten": jenisKonten,
    tanggal: date,
    "hari tanggal": date,
    gerak: movementHeadline,
    source: sourceNames(snapshots),
    sources: sourceNames(snapshots),
    harga_utama: first?.harga_terbaru ?? "-",
    harga: first?.harga_terbaru ?? "-",
    berat: first?.berat ?? "satuan utama",
    delta: first?.delta ?? "belum tersedia",
    buyback: first?.buyback ?? "-"
  };

  return Object.entries(replacements).reduce((result, [key, value]) => {
    const bracePattern = new RegExp(`\\{${key}\\}`, "gi");
    const bracketPattern = new RegExp(`\\[${key}\\]`, "gi");
    return result.replace(bracePattern, value).replace(bracketPattern, value);
  }, template);
}

function allRows(snapshots: GoldPriceSnapshot[]) {
  return snapshots.flatMap((snapshot) => snapshot.price_rows);
}

function rowsBySource(snapshots: GoldPriceSnapshot[]) {
  return snapshots.map((snapshot) => ({
    snapshot,
    rows: snapshot.price_rows.filter((row) => row.harga || row.buyback)
  }));
}

function formatRow(row: GoldPriceRow, includeSource = false) {
  const sourcePrefix = includeSource ? `${row.source_name} - ` : "";
  const delta = row.delta ? ` (${row.delta}${row.percentage_change ? ` / ${row.percentage_change}` : ""})` : "";
  const category = row.category ? `${row.category} - ` : "";
  return `- ${sourcePrefix}${category}${row.berat}: ${row.harga ?? "-"}${delta}`;
}

function priceBlockTitle(jenisKonten: string, sourceName: string) {
  if (jenisKonten.toLowerCase().includes("perhiasan")) return `Harga emas perhiasan ${sourceName} hari ini:`;
  if (jenisKonten.toLowerCase().includes("digital")) return `Harga emas digital ${sourceName} hari ini:`;
  if (jenisKonten.toLowerCase().includes("dunia")) return `Harga emas dunia dari ${sourceName}:`;
  if (jenisKonten.toLowerCase().includes("perak")) return `Harga perak ${sourceName} hari ini:`;
  return `Harga emas ${sourceName} hari ini:`;
}

function priceBlocks(snapshots: GoldPriceSnapshot[]) {
  return rowsBySource(snapshots)
    .filter((group) => group.rows.length)
    .map(({ snapshot, rows }) => {
      const seenWeights = new Set<string>();
      const selectedRows = rows
        .filter((row) => {
          const key = row.berat.toLowerCase();
          if (seenWeights.has(key)) return false;
          seenWeights.add(key);
          return true;
        })
        .slice(0, 14);
      return `${priceBlockTitle(snapshot.jenis_konten, snapshot.source_name)}\n${selectedRows.map((row) => formatRow(row)).join("\n")}`;
    });
}

function comparisonSentence(snapshots: GoldPriceSnapshot[]) {
  const compared = allRows(snapshots).filter((row) => row.delta);
  if (!compared.length) {
    return "Perbandingan dengan harga kemarin akan semakin lengkap setelah histori snapshot harian tersedia di database.";
  }

  const samples = compared.slice(0, 3).map((row) => `${row.source_name} ${row.berat} ${row.delta}`);
  return `Dibandingkan data sebelumnya, pergerakan yang tercatat antara lain ${samples.join(", ")}.`;
}

function marketContext(jenisKonten: string, portal: Portal) {
  const lower = jenisKonten.toLowerCase();
  if (lower.includes("dunia")) {
    return portal === "Beritasatu"
      ? "Pergerakan emas dunia ikut dipengaruhi arah dolar AS, imbal hasil obligasi, dan sentimen geopolitik yang mengubah minat investor terhadap aset aman."
      : "Dari sisi pasar global, pelaku pasar masih mencermati arah dolar AS, ekspektasi suku bunga bank sentral, imbal hasil obligasi pemerintah AS, dan tensi geopolitik yang menentukan permintaan aset safe haven.";
  }
  if (lower.includes("perhiasan")) {
    return "Harga emas perhiasan dipengaruhi kadar karat, biaya produksi, permintaan ritel, serta selisih harga beli dan jual di masing-masing penyedia.";
  }
  if (lower.includes("digital")) {
    return "Untuk emas digital, editor perlu mencermati spread harga beli dan buyback karena selisih antarplatform dapat memengaruhi keputusan transaksi pengguna.";
  }
  if (lower.includes("kecil")) {
    return "Emas pecahan kecil tetap relevan bagi investor ritel karena modal awal lebih rendah dan likuiditas penjualan kembali lebih fleksibel.";
  }
  return "Pergerakan harga domestik tetap dipengaruhi harga emas global, kurs rupiah, biaya distribusi, dan kebijakan harga masing-masing penyedia.";
}

function headlineFor(portal: Portal, jenisKonten: string, snapshots: GoldPriceSnapshot[], template: ArticleTemplateRecord | null) {
  const profile = chooseTemplateProfile(portal);
  const date = todayLabel();
  const movement = movementWordForHeadline(portal, strongestMovement(snapshots));
  const lower = jenisKonten.toLowerCase();

  if (template?.headline_template) {
    const rendered = renderTemplateText(template.headline_template, portal, jenisKonten, snapshots);
    if (rendered.trim()) return rendered.trim();
  }

  if (portal === "Beritasatu") {
    if (lower.includes("perak")) return `Harga Perak Antam Hari Ini ${date} ${movement}`;
    if (lower.includes("dunia")) return `Harga Emas Dunia Hari Ini ${date} ${movement}`;
    return `Harga Emas Antam Hari Ini ${date} ${movement}, Cek Rinciannya`;
  }

  if (lower.includes("antam") && !lower.includes("ubs") && profile.headlinePatterns.some((pattern) => pattern.includes("ANTM"))) {
    return `Harga Emas Antam (ANTM) Hari Ini, ${date}: ${movement}`;
  }
  if (lower.includes("perhiasan")) return `Harga Emas Perhiasan Hari Ini, ${date}, Cek Rinciannya`;
  if (lower.includes("digital")) return `Harga Emas Digital Hari Ini, ${date}: ${movement}`;
  if (lower.includes("kecil")) return `Harga Emas Hari Ini, ${date}, di ${sourceNames(snapshots)}`;
  return `${jenisKonten} Hari Ini, ${date}: ${movement}`;
}

function beritasatuBody(jenisKonten: string, snapshots: GoldPriceSnapshot[], partialFailure: boolean, openingOverride?: string) {
  const first = snapshots[0];
  const body: string[] = [];
  body.push(
    openingOverride ||
      `${portalDateline("Beritasatu")} - ${jenisKonten} pada ${todayLabel()} ${strongestMovement(snapshots)} berdasarkan pembaruan data terbaru dari ${sourceNames(snapshots)}. Harga utama yang terpantau dari ${first.source_name} berada di ${first.harga_terbaru ?? "-"}.`
  );
  body.push(comparisonSentence(snapshots));
  body.push(...priceBlocks(snapshots));
  body.push(marketContext(jenisKonten, "Beritasatu"));

  if (jenisKonten.toLowerCase().includes("antam") || first.source_name === "Logam Mulia") {
    body.push(
      "Untuk transaksi emas batangan, ketentuan pajak tetap mengikuti aturan yang berlaku. Editor dapat menambahkan detail PPh 22 jika artikel akan dipublikasikan sebagai update harga Antam."
    );
  }

  if (partialFailure) body.push("Sebagian source tidak berhasil dimuat. Artikel dibuat berdasarkan data yang tersedia.");
  body.push("Data ini menjadi snapshot awal untuk pembanding harga pada pembaruan berikutnya.");
  return body;
}

function investorDailyBody(jenisKonten: string, snapshots: GoldPriceSnapshot[], partialFailure: boolean, openingOverride?: string) {
  const first = snapshots[0];
  const body: string[] = [];
  body.push(
    openingOverride ||
      `${portalDateline("Investor Daily")} - ${jenisKonten} kembali menjadi perhatian investor pada ${todayLabel()}. Data terbaru dari ${sourceNames(snapshots)} menunjukkan harga utama berada di ${first.harga_terbaru ?? "-"} untuk ${first.berat ?? "satuan utama"}.`
  );
  body.push(
    `${comparisonSentence(snapshots)} Informasi ini penting karena perubahan harga harian dapat memengaruhi keputusan beli, jual, maupun strategi akumulasi emas secara bertahap.`
  );
  body.push(marketContext(jenisKonten, "Investor Daily"));
  body.push(...priceBlocks(snapshots));
  body.push("Bagi investor ritel, daftar harga per berat membantu menghitung kebutuhan modal secara lebih presisi sebelum mengambil keputusan transaksi.");

  if (partialFailure) body.push("Sebagian source tidak berhasil dimuat. Artikel dibuat berdasarkan data yang tersedia.");
  body.push(
    "Ke depan, editor dapat memperkaya artikel dengan tren 7 hari terakhir, perbandingan antarplatform, serta sentimen pasar global agar pembaca mendapat konteks yang lebih utuh."
  );
  return body;
}

export async function generateArticle(
  portal: Portal,
  jenisKonten: string,
  snapshots: GoldPriceSnapshot[]
): Promise<{ ok: boolean; article?: GeneratedArticle; notifications: DashboardNotification[] }> {
  const usable = snapshots.filter((snapshot) => snapshot.status === "success" && snapshot.price_rows.some((row) => row.harga || row.buyback));
  const partialFailure = snapshots.some((snapshot) => snapshot.status !== "success");
  if (!usable.length) {
    return {
      ok: false,
      notifications: [
        {
          id: crypto.randomUUID(),
          kind: "warning",
          title: "Generate artikel diblokir",
          message: "Generate artikel tidak dapat dilakukan karena data source belum berhasil dimuat."
        }
      ]
    };
  }

  const runtimeTemplate = await getRuntimeArticleTemplate(portal, jenisKonten);
  const openingOverride = runtimeTemplate?.body_template
    ? renderTemplateText(runtimeTemplate.body_template, portal, jenisKonten, usable)
    : undefined;
  const body =
    portal === "Beritasatu"
      ? beritasatuBody(jenisKonten, usable, partialFailure, openingOverride)
      : investorDailyBody(jenisKonten, usable, partialFailure, openingOverride);

  return {
    ok: true,
    article: {
      headline: headlineFor(portal, jenisKonten, usable, runtimeTemplate),
      lead:
        portal === "Beritasatu"
          ? `${portalDateline(portal)} - ${jenisKonten} terpantau ${strongestMovement(usable)} berdasarkan pembaruan data ${sourceNames(usable)}.`
          : `${portalDateline(portal)} - ${jenisKonten} menjadi perhatian pasar setelah data ${sourceNames(usable)} menunjukkan pergerakan terbaru harga emas.`,
      body,
      sourceLinks: [...new Set(usable.map((snapshot) => snapshot.source_url))],
      disclaimer: partialFailure ? "Sebagian source tidak berhasil dimuat. Artikel dibuat berdasarkan data yang tersedia." : undefined
    },
    notifications: [
      {
        id: crypto.randomUUID(),
        kind: "success",
        title: "Artikel berhasil dibuat",
        message: "Draft artikel otomatis siap direview editor."
      }
    ]
  };
}
