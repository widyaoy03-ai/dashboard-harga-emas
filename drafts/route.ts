import { NextResponse } from "next/server";
import { z } from "zod";
import { getArticleDrafts, updateArticleDraft } from "@/lib/storage";
import type { DraftStatus } from "@/lib/types";

const updateSchema = z.object({
  id: z.string().min(1),
  title: z.string().optional(),
  lead: z.string().optional(),
  body: z.array(z.string()).optional(),
  status_draft: z.enum(["Pending Review", "Revision Need", "Approved", "Rejected"]).optional(),
  assigned_editor: z.string().optional(),
  review_note: z.string().nullable().optional(),
  review_note_updated_by: z.string().optional()
});

export const runtime = "nodejs";

export async function GET() {
  const drafts = await getArticleDrafts();
  return NextResponse.json({ ok: true, drafts });
}

export async function PATCH(request: Request) {
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "Data draft tidak valid." }, { status: 400 });
  }

  const draft = await updateArticleDraft(parsed.data.id, {
    title: parsed.data.title,
    lead: parsed.data.lead,
    body: parsed.data.body,
    status_draft: parsed.data.status_draft as DraftStatus | undefined,
    assigned_editor: parsed.data.assigned_editor,
    review_note: parsed.data.review_note ?? undefined,
    review_note_updated_by: parsed.data.review_note_updated_by
  });

  if (!draft) {
    return NextResponse.json({ ok: false, message: "Draft tidak ditemukan." }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    draft,
    notification: {
      id: crypto.randomUUID(),
      kind: "success",
      title: "Draft tersimpan",
      message: "Status, artikel, dan catatan review berhasil diperbarui."
    }
  });
}
