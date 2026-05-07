import { NextResponse } from "next/server";
import { z } from "zod";
import { getRuntimeSourcesForContent } from "@/lib/admin-storage";
import { portalContentTypes } from "@/lib/content-framework";
import type { Portal } from "@/lib/types";

const schema = z.object({
  portal: z.enum(["Beritasatu", "Investor Daily"]),
  jenisKonten: z.string().min(1)
});

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = schema.safeParse({
    portal: url.searchParams.get("portal"),
    jenisKonten: url.searchParams.get("jenisKonten")
  });

  if (!parsed.success) {
    return NextResponse.json({ ok: false, sources: [], message: "Portal dan jenis konten wajib dipilih." }, { status: 400 });
  }

  const portal = parsed.data.portal as Portal;
  if (!portalContentTypes[portal].includes(parsed.data.jenisKonten)) {
    return NextResponse.json({ ok: false, sources: [], message: "Jenis konten tidak sesuai portal." }, { status: 400 });
  }

  const sources = await getRuntimeSourcesForContent(portal, parsed.data.jenisKonten);
  return NextResponse.json({
    ok: true,
    sources: sources.map((source) => ({
      name: source.name,
      mode: source.mode,
      group: source.group,
      url: source.url,
      selectorSummary: source.selectorSummary,
      rowSelector: source.rowSelector ?? null,
      dataSelector: source.dataSelector ?? null,
      operationalNote: source.operationalNote ?? null
    }))
  });
}
