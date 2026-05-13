import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin-auth";
import { auditSourceDocumentText } from "@/lib/source-document-audit";

export const runtime = "nodejs";

function unauthorized() {
  return NextResponse.json({ ok: false, message: "Akses admin membutuhkan ADMIN_TOKEN yang valid." }, { status: 401 });
}

export async function POST(request: Request) {
  if (!isAdminRequest(request)) return unauthorized();

  const form = await request.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, message: "File DOCX source belum dipilih." }, { status: 400 });
  }

  if (!file.name.toLowerCase().endsWith(".docx")) {
    return NextResponse.json({ ok: false, message: "Format source harus DOCX agar element dapat dibaca." }, { status: 400 });
  }

  const mammoth = await import("mammoth");
  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await mammoth.extractRawText({ buffer });
  const audit = await auditSourceDocumentText(result.value, file.name);

  return NextResponse.json({
    ok: audit.ok,
    status: audit.status,
    extraction: audit.extraction,
    validation: audit.validation,
    notification: {
      id: crypto.randomUUID(),
      kind: audit.ok ? "success" : "warning",
      title: audit.ok ? "Source Logam Mulia valid" : "Source Logam Mulia perlu dicek",
      message: audit.ok
        ? "Selector dan mapping Logam Mulia berhasil divalidasi ke website real."
        : audit.validation.reasons[0] ?? "Validasi source belum berhasil."
    }
  });
}
