import { NextResponse } from "next/server";
import { z } from "zod";
import { getRuntimeSourcesForContent, getRuntimeSourcesForPortal } from "@/lib/admin-storage";
import type { Portal } from "@/lib/types";

const schema = z.object({
  portal: z.enum(["Beritasatu", "Investor Daily"]),
  jenisKonten: z.string().optional().nullable()
});

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = schema.safeParse({
    portal: url.searchParams.get("portal"),
    jenisKonten: url.searchParams.get("jenisKonten")
  });

  if (!parsed.success) {
    return NextResponse.json({ ok: false, sources: [], message: "Portal wajib dipilih." }, { status: 400 });
  }

  const portal = parsed.data.portal as Portal;
  const sources = parsed.data.jenisKonten
    ? await getRuntimeSourcesForContent(portal, parsed.data.jenisKonten)
    : await getRuntimeSourcesForPortal(portal);
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
