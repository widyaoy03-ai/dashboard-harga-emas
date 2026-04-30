import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin-auth";
import { getHistoryUploads, saveHistoryUpload } from "@/lib/admin-storage";
import { parseUploadedFile } from "@/lib/file-parsers";

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

  const uploads = await getHistoryUploads();
  return NextResponse.json({ ok: true, uploads });
}

export async function POST(request: Request) {
  if (!isAdminRequest(request)) return unauthorized();

  const form = await request.formData();
  const file = form.get("file");
  const uploadMode = form.get("mode") === "replace" ? "replace" : "append";

  if (!(file instanceof File)) {
    return NextResponse.json(
      {
        ok: false,
        message: "File tidak ditemukan. Upload DOCX, XLSX, XLS, atau CSV."
      },
      { status: 400 }
    );
  }

  try {
    const parsed = await parseUploadedFile(file);
    const record = await saveHistoryUpload(file.name, parsed.type, uploadMode, parsed);
    return NextResponse.json({
      ok: true,
      upload: record,
      notification: {
        id: crypto.randomUUID(),
        kind: "success",
        title: "Histori tersimpan",
        message: uploadMode === "replace" ? "Histori lama diganti dengan file baru." : "Histori baru berhasil ditambahkan."
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "File gagal diproses."
      },
      { status: 422 }
    );
  }
}
