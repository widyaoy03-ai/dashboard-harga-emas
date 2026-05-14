import { NextResponse } from "next/server";
import { z } from "zod";
import { isAdminRequest } from "@/lib/admin-auth";
import { adminSourceToConfig, getAdminSources, getRuntimeSourcesForContent } from "@/lib/admin-storage";
import { validateSourceScrape } from "@/lib/scraper";
import type { Portal } from "@/lib/types";

const debugSchema = z.object({
  portal: z.enum(["Beritasatu", "Investor Daily"]).optional().default("Beritasatu"),
  jenisKonten: z.string().optional().default("Harga Emas"),
  sourceName: z.string().optional().default("Logam Mulia")
});

export const runtime = "nodejs";

function unauthorized() {
  return NextResponse.json({ ok: false, message: "Akses admin membutuhkan ADMIN_TOKEN yang valid." }, { status: 401 });
}

export async function POST(request: Request) {
  if (!isAdminRequest(request)) return unauthorized();

  const parsed = debugSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "Payload debug source tidak valid." }, { status: 400 });
  }

  const portal = parsed.data.portal as Portal;
  const runtimeSources = await getRuntimeSourcesForContent(portal, parsed.data.jenisKonten);
  let source = runtimeSources.find((item) => item.name === parsed.data.sourceName);
  let sourceOrigin = "runtime-content-mapping";

  if (!source) {
    const adminSources = await getAdminSources();
    const adminSource = adminSources.find((item) => item.name === parsed.data.sourceName);
    if (adminSource) {
      source = adminSourceToConfig(adminSource);
      sourceOrigin = "admin-source-master";
    }
  }

  if (!source) {
    return NextResponse.json(
      {
        ok: false,
        message: `Source ${parsed.data.sourceName} tidak ditemukan di runtime mapping atau admin source master.`,
        requested: parsed.data
      },
      { status: 404 }
    );
  }

  const validation = await validateSourceScrape(source, parsed.data.jenisKonten);
  return NextResponse.json({
    ok: validation.ok,
    sourceOrigin,
    requested: parsed.data,
    sourceConfig: {
      name: source.name,
      url: source.url,
      mode: source.mode,
      group: source.group,
      parserType: source.parserType,
      dataSelector: source.dataSelector,
      rowSelector: source.rowSelector,
      fieldMapping: source.fieldMapping,
      elementKeywords: source.elementKeywords,
      boundaryStartKeywords: source.boundaryStartKeywords,
      boundaryStopKeywords: source.boundaryStopKeywords
    },
    validation
  });
}
