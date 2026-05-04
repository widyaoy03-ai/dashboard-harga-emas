import { NextResponse } from "next/server";
import { getHistoricalSnapshots } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET() {
  const snapshots = await getHistoricalSnapshots();
  return NextResponse.json({
    ok: true,
    snapshots
  });
}
