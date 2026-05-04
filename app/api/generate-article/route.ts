import { NextResponse } from "next/server";
import { z } from "zod";
import { generateArticle } from "@/lib/article-generator";
import type { GoldPriceSnapshot, Portal } from "@/lib/types";

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
  snapshots: z.array(snapshotSchema)
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

  return NextResponse.json(response, { status: response.ok ? 200 : 422 });
}
