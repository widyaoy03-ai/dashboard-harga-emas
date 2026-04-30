import { NextResponse } from "next/server";
import { parseUploadedFile } from "@/lib/file-parsers";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");

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
    return NextResponse.json({
      ok: true,
      parsed
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
