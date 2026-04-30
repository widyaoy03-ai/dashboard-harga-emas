import { NextResponse } from "next/server";
import { z } from "zod";
import { portalContentTypes } from "@/lib/content-framework";
import { runData } from "@/lib/scraper";
import type { Portal } from "@/lib/types";

const schema = z.object({
  portal: z.enum(["Beritasatu", "Investor Daily"]),
  jenisKonten: z.string().min(1)
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
            title: "Pilihan belum lengkap",
            message: "RUN DATA membutuhkan portal dan jenis konten."
          }
        ]
      },
      { status: 400 }
    );
  }

  const portal = parsed.data.portal as Portal;
  if (!portalContentTypes[portal].includes(parsed.data.jenisKonten)) {
    return NextResponse.json(
      {
        ok: false,
        notifications: [
          {
            id: crypto.randomUUID(),
            kind: "warning",
            title: "Jenis konten tidak valid",
            message: "Jenis konten tidak sesuai dengan portal yang dipilih."
          }
        ]
      },
      { status: 400 }
    );
  }

  const response = await runData(portal, parsed.data.jenisKonten);
  return NextResponse.json(response);
}
