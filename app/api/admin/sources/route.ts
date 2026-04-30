import { NextResponse } from "next/server";
import { z } from "zod";
import { isAdminRequest } from "@/lib/admin-auth";
import { getAdminSources, upsertAdminSource } from "@/lib/admin-storage";

const sourceSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  url: z.string().min(1),
  mode: z.enum(["otomatis", "manual"]),
  group: z.enum(["antam", "perak", "dunia", "perhiasan", "pegadaian", "digital", "emas-kecil", "manual"]),
  selectorSummary: z.string().optional().default(""),
  titleSelector: z.string().optional(),
  dataSelector: z.string().optional(),
  timestampSelector: z.string().optional(),
  elementKeywords: z.array(z.string()).default([]),
  priceCurrency: z.enum(["IDR", "USD"]),
  operationalNote: z.string().optional(),
  is_active: z.boolean(),
  content_mapping: z
    .array(
      z.object({
        portal: z.enum(["Beritasatu", "Investor Daily"]),
        jenis_konten: z.string().min(1)
      })
    )
    .default([])
});

export const runtime = "nodejs";

function unauthorized() {
  return NextResponse.json(
    {
      ok: false,
      message: "Akses admin membutuhkan ADMIN_TOKEN yang valid."
    },
    { status: 401 }
  );
}

export async function GET(request: Request) {
  if (!isAdminRequest(request)) return unauthorized();

  const sources = await getAdminSources();
  return NextResponse.json({ ok: true, sources });
}

export async function POST(request: Request) {
  if (!isAdminRequest(request)) return unauthorized();

  const parsed = sourceSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        message: "Data source belum lengkap atau formatnya tidak valid."
      },
      { status: 400 }
    );
  }

  const source = await upsertAdminSource({
    ...parsed.data,
    titleSelector: parsed.data.titleSelector || undefined,
    dataSelector: parsed.data.dataSelector || undefined,
    timestampSelector: parsed.data.timestampSelector || undefined,
    operationalNote: parsed.data.operationalNote || undefined,
    elementKeywords: parsed.data.elementKeywords.map((keyword) => keyword.trim()).filter(Boolean)
  });

  return NextResponse.json({
    ok: true,
    source,
    notification: {
      id: crypto.randomUUID(),
      kind: "success",
      title: "Source tersimpan",
      message: `Pengaturan source ${source.name} langsung aktif tanpa redeploy.`
    }
  });
}
