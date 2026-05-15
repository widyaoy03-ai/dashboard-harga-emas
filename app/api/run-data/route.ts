import { NextResponse } from "next/server";
import { z } from "zod";
import { runData } from "@/lib/scraper";
import type { Portal } from "@/lib/types";

const schema = z.object({
  portal: z.enum(["Beritasatu", "Investor Daily"]),
  jenisKonten: z.string().optional().default("Artikel Harga Emas/Perak Source-Based"),
  source: z.string().optional().nullable(),
  sources: z.array(z.string()).optional().nullable()
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
            message: "RUN DATA membutuhkan portal dan minimal satu source aktif."
          }
        ]
      },
      { status: 400 }
    );
  }

  const portal = parsed.data.portal as Portal;
  const response = await runData(portal, parsed.data.jenisKonten, parsed.data.sources ?? parsed.data.source);
  return NextResponse.json(response);
}
