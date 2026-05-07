import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin-auth";
import { runDatabaseHealthCheck } from "@/lib/db";

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

  try {
    const health = await runDatabaseHealthCheck();
    return NextResponse.json(health, { status: health.ok ? 200 : 503 });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        connected: false,
        message: error instanceof Error ? error.message : "Koneksi database gagal."
      },
      { status: 500 }
    );
  }
}
