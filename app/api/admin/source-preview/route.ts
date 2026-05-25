import { NextResponse } from "next/server";
import { z } from "zod";
import { isAdminRequest } from "@/lib/admin-auth";
import { previewSourceScrape } from "@/lib/scraper";
import type { SourceConfig } from "@/lib/types";

const previewSchema = z.object({
  name: z.string().min(1),
  url: z.string().min(1),
  mode: z.enum(["otomatis", "manual"]),
  group: z.enum(["antam", "perak", "dunia", "perhiasan", "pegadaian", "digital", "emas-kecil", "manual"]),
  selectorSummary: z.string().optional().default(""),
  parserType: z.enum(["generic-table", "logam-mulia", "raja-emas"]).optional(),
  titleSelector: z.string().optional(),
  dataSelector: z.string().optional(),
  rowSelector: z.string().optional(),
  fieldMapping: z
    .object({
      weightIndex: z.number().int().nonnegative().optional(),
      priceIndex: z.number().int().nonnegative().optional(),
      basePriceIndex: z.number().int().nonnegative().optional(),
      pricePph025Index: z.number().int().nonnegative().optional(),
      productTypeIndex: z.number().int().nonnegative().optional()
    })
    .optional(),
  timestampSelector: z.string().optional(),
  elementKeywords: z.array(z.string()).default([]),
  includeKeywords: z.array(z.string()).default([]),
  excludeKeywords: z.array(z.string()).default([]),
  boundaryStartKeywords: z.array(z.string()).default([]),
  boundaryStopKeywords: z.array(z.string()).default([]),
  priceCurrency: z.enum(["IDR", "USD"]),
  operationalNote: z.string().optional(),
  jenisKonten: z.string().optional()
});

export const runtime = "nodejs";

function unauthorized() {
  return NextResponse.json({ ok: false, message: "Akses admin membutuhkan ADMIN_TOKEN yang valid." }, { status: 401 });
}

export async function POST(request: Request) {
  if (!isAdminRequest(request)) return unauthorized();

  const parsed = previewSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "Konfigurasi preview belum valid." }, { status: 400 });
  }

  const source: SourceConfig = {
    name: parsed.data.name,
    url: parsed.data.url,
    mode: parsed.data.mode,
    group: parsed.data.group,
    selectorSummary: parsed.data.selectorSummary,
    parserType: parsed.data.parserType ?? "generic-table",
    titleSelector: parsed.data.titleSelector || undefined,
    dataSelector: parsed.data.dataSelector || undefined,
    rowSelector: parsed.data.rowSelector || undefined,
    fieldMapping: parsed.data.fieldMapping,
    timestampSelector: parsed.data.timestampSelector || undefined,
    elementKeywords: parsed.data.elementKeywords,
    includeKeywords: parsed.data.includeKeywords,
    excludeKeywords: parsed.data.excludeKeywords,
    boundaryStartKeywords: parsed.data.boundaryStartKeywords,
    boundaryStopKeywords: parsed.data.boundaryStopKeywords,
    priceCurrency: parsed.data.priceCurrency,
    operationalNote: parsed.data.operationalNote
  };

  const preview = await previewSourceScrape(source, parsed.data.jenisKonten);
  return NextResponse.json({ ok: preview.ok, preview });
}
