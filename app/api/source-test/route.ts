import { NextResponse } from "next/server";
import { preflightRows } from "@/lib/content-framework";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    ok: true,
    rows: preflightRows,
    updatedAt: "2026-04-29T22:08:33+07:00",
    note: "CNBC Metals, Treasury, Emasku, Mini Gold, dan HRTA Gold terdokumentasi sebagai source manual sementara."
  });
}
