import { NextResponse } from "next/server";
import { z } from "zod";
import { isAdminRequest } from "@/lib/admin-auth";
import { getAdminTemplates, upsertArticleTemplate } from "@/lib/admin-storage";

const templateSchema = z.object({
  id: z.string().optional(),
  portal: z.enum(["Beritasatu", "Investor Daily"]),
  jenis_konten: z.string().min(1),
  headline_template: z.string().min(1),
  body_template: z.string().min(1),
  source_mapping: z.array(z.string()).default([]),
  example_patterns: z.array(z.string()).default([]),
  is_active: z.boolean()
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

  const templates = await getAdminTemplates();
  return NextResponse.json({ ok: true, templates });
}

export async function POST(request: Request) {
  if (!isAdminRequest(request)) return unauthorized();

  const parsed = templateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        message: "Template artikel belum lengkap atau formatnya tidak valid."
      },
      { status: 400 }
    );
  }

  const template = await upsertArticleTemplate({
    ...parsed.data,
    source_mapping: parsed.data.source_mapping.map((source) => source.trim()).filter(Boolean),
    example_patterns: parsed.data.example_patterns.map((pattern) => pattern.trim()).filter(Boolean)
  });

  return NextResponse.json({
    ok: true,
    template,
    notification: {
      id: crypto.randomUUID(),
      kind: "success",
      title: "Template tersimpan",
      message: `Template ${template.portal} / ${template.jenis_konten} langsung dipakai saat RUN ARTIKEL.`
    }
  });
}
