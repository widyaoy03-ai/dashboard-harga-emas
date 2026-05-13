import { NextResponse } from "next/server";
import { z } from "zod";
import { generateArticle } from "@/lib/article-generator";
import { saveArticleDraft } from "@/lib/storage";
import type { ArticleDraftRecord, DataStatus, GoldPriceSnapshot, Portal } from "@/lib/types";

const snapshotSchema = z.object({
  id: z.string(),
  portal: z.enum(["Beritasatu", "Investor Daily"]),
  jenis_konten: z.string(),
  source_name: z.string(),
  source_url: z.string(),
  run_time: z.string(),
  update_time: z.string().nullable(),
  jenis_emas: z.string(),
  berat: z.string().nullable(),
  harga_terbaru: z.string().nullable(),
  harga_kemarin: z.string().nullable(),
  buyback: z.string().nullable(),
  delta: z.string().nullable(),
  percentage_change: z.string().nullable(),
  tanggal_snapshot: z.string(),
  status: z.enum(["success", "warning", "error", "manual"]),
  catatan: z.string(),
  price_rows: z.array(
    z.object({
      id: z.string(),
      source_name: z.string(),
      source_url: z.string(),
      jenis_emas: z.string(),
      product_type: z.string().nullable().optional(),
      weight: z.string().nullable().optional(),
      base_price: z.number().nullable().optional(),
      price_pph_025: z.number().nullable().optional(),
      source: z.string().nullable().optional(),
      scraped_at: z.string().nullable().optional(),
      section_name: z.string().nullable().optional(),
      category: z.string().nullable().optional(),
      berat: z.string(),
      harga: z.string().nullable(),
      buyback: z.string().nullable(),
      waktu_update: z.string().nullable(),
      tanggal_update: z.string().nullable(),
      delta: z.string().nullable(),
      percentage_change: z.string().nullable()
      .optional(),
      previous_snapshot_date: z.string().nullable().optional(),
      previous_snapshot_run_time: z.string().nullable().optional()
    })
  )
});

const schema = z.object({
  portal: z.enum(["Beritasatu", "Investor Daily"]),
  jenisKonten: z.string().min(1),
  snapshots: z.array(snapshotSchema),
  triggeredBy: z.string().optional(),
  assignedEditor: z.string().optional()
});

export const runtime = "nodejs";

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        notifications: [
          {
            id: crypto.randomUUID(),
            kind: "warning",
            title: "Generate artikel belum siap",
            message: "Run Artikel hanya aktif jika data sudah berhasil di-run, portal dipilih, dan jenis konten dipilih."
          }
        ]
      },
      { status: 400 }
    );
  }

  const response = await generateArticle(
    parsed.data.portal as Portal,
    parsed.data.jenisKonten,
    parsed.data.snapshots as GoldPriceSnapshot[]
  );

  if (response.ok && response.article) {
    const successful = parsed.data.snapshots.filter((snapshot) => snapshot.status === "success");
    const dataStatus: DataStatus =
      successful.length === parsed.data.snapshots.length ? "Success" : successful.length > 0 ? "Partial Success" : "Failed";
    const now = new Date();
    const draft: ArticleDraftRecord = await saveArticleDraft({
      id: crypto.randomUUID(),
      portal: parsed.data.portal as Portal,
      jenis_konten: parsed.data.jenisKonten,
      title: response.article.headline,
      lead: response.article.lead,
      body: response.article.body,
      source_links: response.article.sourceLinks,
      date: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(now),
      generated_at: now.toISOString(),
      triggered_by: parsed.data.triggeredBy?.trim() || "Editor Piket",
      assigned_editor: parsed.data.assignedEditor?.trim() || parsed.data.triggeredBy?.trim() || "Editor Piket",
      data_status: dataStatus,
      status_draft: "Pending Review",
      source_details: parsed.data.snapshots.map((snapshot) => ({
        source_name: snapshot.source_name,
        status: snapshot.status,
        catatan: snapshot.catatan,
        row_count: snapshot.price_rows.length
      })),
      review_note: null,
      review_note_updated_at: null,
      review_note_updated_by: null
    });
    return NextResponse.json({ ...response, draft }, { status: 200 });
  }

  return NextResponse.json(response, { status: response.ok ? 200 : 422 });
}
