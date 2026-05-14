import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin-auth";
import { getAdminSources, getMonitorLogs, saveMonitorLogs } from "@/lib/admin-storage";
import type { AdminSourceRecord, SourceMonitorLog } from "@/lib/types";

const userAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

function blockedHint(html: string, status: number) {
  const sample = html.slice(0, 3000).toLowerCase();
  if ([401, 403, 429, 503].includes(status)) return `HTTP ${status} mengindikasikan akses ditolak/rate limited.`;
  if (/cloudflare|captcha|access denied|forbidden|blocked|bot detection|enable javascript/i.test(sample)) {
    return "Response mengandung indikasi proteksi anti-bot/captcha/access denied.";
  }
  if (html && html.length < 200) return "Response terlalu pendek/kosong.";
  return null;
}

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

async function checkSource(source: AdminSourceRecord): Promise<Omit<SourceMonitorLog, "id" | "checked_at">> {
  if (!source.is_active) {
    return {
      source_name: source.name,
      source_url: source.url,
      status: "warning",
      http_status: null,
      message: "Source nonaktif di pengaturan admin."
    };
  }

  if (source.mode === "manual") {
    return {
      source_name: source.name,
      source_url: source.url,
      status: "manual",
      http_status: null,
      message: source.operationalNote ?? `${source.name} sementara diisi manual oleh editor.`
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(source.url, {
      headers: {
        "user-agent": userAgent,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "accept-language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
        "cache-control": "no-cache",
        pragma: "no-cache",
        referer: new URL(source.url).origin + "/",
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "same-origin",
        "upgrade-insecure-requests": "1"
      },
      signal: controller.signal,
      redirect: "follow",
      cache: "no-store"
    });
    const html = await response.text();
    const hint = blockedHint(html, response.status);
    const haystack = html.toLowerCase();
    const hasElement =
      source.elementKeywords.length === 0 ||
      source.elementKeywords.some((keyword) => haystack.includes(keyword.toLowerCase()));

    if (!response.ok) {
      return {
        source_name: source.name,
        source_url: source.url,
        status: "error",
        http_status: response.status,
        message: `Source ${source.name} mengembalikan HTTP ${response.status}. Size: ${html.length} karakter. ${hint ?? ""}`.trim()
      };
    }

    if (hint) {
      return {
        source_name: source.name,
        source_url: source.url,
        status: "error",
        http_status: response.status,
        message: `Source ${source.name} merespons, tetapi bermasalah. Size: ${html.length} karakter. ${hint}`
      };
    }

    if (!hasElement) {
      return {
        source_name: source.name,
        source_url: source.url,
        status: "error",
        http_status: response.status,
        message: `Element data ${source.name} tidak ditemukan. HTTP ${response.status}, size ${html.length} karakter. Keyword dicek: ${source.elementKeywords.join(", ") || "-"}.`
      };
    }

    return {
      source_name: source.name,
      source_url: source.url,
      status: "success",
      http_status: response.status,
      message: `Source ${source.name} aktif. HTTP ${response.status}, size ${html.length} karakter, element utama ditemukan.`
    };
  } catch (error) {
    return {
      source_name: source.name,
      source_url: source.url,
      status: "error",
      http_status: null,
      message: `Source ${source.name} tidak dapat dicek: ${error instanceof Error ? `${error.name} - ${error.message}` : "unknown error"}.`
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(request: Request) {
  if (!isAdminRequest(request)) return unauthorized();

  const logs = await getMonitorLogs();
  return NextResponse.json({ ok: true, logs });
}

export async function POST(request: Request) {
  if (!isAdminRequest(request)) return unauthorized();

  const sources = await getAdminSources();
  const checks = await Promise.all(sources.map(checkSource));
  const logs = await saveMonitorLogs(checks);
  const errorCount = checks.filter((item) => item.status === "error").length;

  return NextResponse.json({
    ok: errorCount === 0,
    logs,
    notification: {
      id: crypto.randomUUID(),
      kind: errorCount ? "warning" : "success",
      title: errorCount ? "Monitoring selesai dengan catatan" : "Monitoring source berhasil",
      message: errorCount
        ? "Sebagian source tidak dapat diakses. Detail tersimpan di error log."
        : "Semua source aktif/manual berhasil dicek."
    }
  });
}
