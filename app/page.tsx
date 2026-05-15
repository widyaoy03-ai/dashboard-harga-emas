"use client";

import { useEffect, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider, useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Archive,
  BarChart3,
  Bell,
  BookOpen,
  CheckCircle2,
  Clipboard,
  Database,
  Download,
  Edit3,
  FileText,
  HelpCircle,
  History,
  Info,
  LayoutDashboard,
  Loader2,
  MessageSquare,
  Play,
  Search,
  Settings,
  TableProperties,
  X,
  Zap
} from "lucide-react";
import { AdminCMSPanel } from "@/components/AdminCMSPanel";
import { contentSourceMap, menuItems, portalContentTypes, preflightRows, sourceConfigs } from "@/lib/content-framework";
import { useDashboardStore } from "@/lib/dashboard-store";
import { buildSourceDataViews } from "@/lib/source-data-view";
import type {
  ArticleDraftRecord,
  DashboardNotification,
  DraftStatus,
  GenerateArticleResponse,
  GenerateMode,
  GoldPriceRow,
  GoldPriceSnapshot,
  Portal,
  RunDataResponse,
  SourceDataColumn,
  SourceDataView
} from "@/lib/types";

const queryClient = new QueryClient();
const ALL_SOURCES = "Semua Source";
const SOURCE_BASED_CONTENT_LABEL = "Source-Based Harga Emas/Perak";

function sourceContextLabel(selectedSources: string[]) {
  return selectedSources.length ? `Source: ${selectedSources.join(", ")}` : "Semua Source Aktif";
}

const iconMap = {
  Overview: LayoutDashboard,
  "Generate Artikel": Zap,
  "Data Harga Emas": TableProperties,
  Histori: History,
  Documentation: BookOpen,
  Pengaturan: Settings
};

type SourceOption = {
  name: string;
  mode: "otomatis" | "manual";
  group: string;
  url: string;
  selectorSummary: string;
  operationalNote: string | null;
};

type SourceResponse = {
  ok: boolean;
  sources: SourceOption[];
};

type HistoryResponse = {
  ok: boolean;
  snapshots: GoldPriceSnapshot[];
};

type DraftsResponse = {
  ok: boolean;
  drafts: ArticleDraftRecord[];
};

type DraftUpdateResponse = {
  ok: boolean;
  draft: ArticleDraftRecord;
  notification?: DashboardNotification;
};

type PriceRowWithSnapshot = {
  snapshot: GoldPriceSnapshot;
  row: GoldPriceRow;
};

function statusClass(status: string) {
  if (status === "success" || status === "Berhasil" || status === "Ya") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "manual" || status === "Manual" || status === "warning") return "bg-amber-50 text-amber-700 border-amber-200";
  if (status === "error" || status === "Gagal" || status === "Tidak") return "bg-red-50 text-red-700 border-red-200";
  return "bg-slate-50 text-slate-700 border-slate-200";
}

function deltaClass(delta?: string | null) {
  if (!delta || delta === "-") return "text-slate-500";
  if (delta.trim().startsWith("+")) return "text-emerald-700";
  if (delta.trim().startsWith("-")) return "text-red-700";
  return "text-slate-500";
}

function formatMoney(value?: string | null) {
  if (!value) return "-";
  const clean = value.trim();
  if (/^(Rp|US\$)/i.test(clean)) return clean.replace(/^Rp\.?/i, "Rp");
  const digits = clean.replace(/[^\d]/g, "");
  if (!digits) return clean;
  return `Rp ${Number(digits).toLocaleString("id-ID")}`;
}

function formatNumericRupiah(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return `Rp ${value.toLocaleString("id-ID")}`;
}

function formatNumericPrice(row: GoldPriceRow, value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  if (row.harga?.startsWith("US$")) return `US$ ${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return formatNumericRupiah(value);
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function numericPrice(value?: string | null) {
  if (!value) return null;
  const clean = value.replace(/[^\d,.-]/g, "");
  if (!clean) return null;
  if (clean.includes(",") && clean.includes(".")) {
    const lastComma = clean.lastIndexOf(",");
    const lastDot = clean.lastIndexOf(".");
    return lastComma > lastDot ? Number(clean.replace(/\./g, "").replace(",", ".")) : Number(clean.replace(/,/g, ""));
  }
  if (clean.includes(",")) {
    const parts = clean.split(",");
    return parts.at(-1)?.length === 2 ? Number(clean.replace(/\./g, "").replace(",", ".")) : Number(clean.replace(/,/g, ""));
  }
  return Number(clean.replace(/\./g, ""));
}

function formatDeltaFromNumbers(current?: string | null, previous?: string | null) {
  const currentValue = numericPrice(current);
  const previousValue = numericPrice(previous);
  if (currentValue === null || previousValue === null || Number.isNaN(currentValue) || Number.isNaN(previousValue)) {
    return { delta: null, percentage: null };
  }
  const diff = currentValue - previousValue;
  const percentage = previousValue === 0 ? null : `${diff >= 0 ? "+" : ""}${((diff / previousValue) * 100).toFixed(2)}%`;
  return {
    delta: `${diff >= 0 ? "+" : "-"}Rp ${Math.abs(diff).toLocaleString("id-ID")}`,
    percentage
  };
}

function flattenPriceRows(snapshots: GoldPriceSnapshot[]): PriceRowWithSnapshot[] {
  return snapshots.flatMap((snapshot) =>
    snapshot.price_rows.length
      ? snapshot.price_rows.map((row) => ({ snapshot, row }))
      : [
          {
            snapshot,
            row: {
              id: `${snapshot.id}-empty`,
              source_name: snapshot.source_name,
              source_url: snapshot.source_url,
              jenis_emas: snapshot.jenis_emas,
              product_type: snapshot.jenis_emas,
              weight: snapshot.berat ?? "-",
              base_price: null,
              price_pph_025: null,
              source: snapshot.source_name,
              scraped_at: snapshot.update_time,
              section_name: null,
              category: null,
              berat: snapshot.berat ?? "-",
              harga: snapshot.harga_terbaru,
              buyback: snapshot.buyback,
              waktu_update: snapshot.update_time,
              tanggal_update: snapshot.update_time,
              delta: snapshot.delta,
              percentage_change: snapshot.percentage_change,
              previous_snapshot_date: null,
              previous_snapshot_run_time: null
            }
          }
        ]
  );
}

function dedupeSnapshots(snapshots: GoldPriceSnapshot[]) {
  const seen = new Set<string>();
  return snapshots.filter((snapshot) => {
    if (seen.has(snapshot.id)) return false;
    seen.add(snapshot.id);
    return true;
  });
}

function HelpTooltip({ text, detailId }: { text: string; detailId?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        onBlur={() => setOpen(false)}
        className="group/help grid h-5 w-5 place-items-center rounded-full border border-border bg-surface text-textSecondary"
        aria-label="Bantuan"
      >
        <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
        <span
          className={`pointer-events-none absolute bottom-7 left-1/2 z-40 w-64 -translate-x-1/2 rounded-md bg-primaryDark px-3 py-2 text-left text-xs leading-5 text-white opacity-0 shadow-panel transition delay-300 group-hover/help:opacity-100 ${
            open ? "opacity-100" : ""
          }`}
        >
          {text}
          {detailId && (
            <a href={`#${detailId}`} className="mt-1 block font-semibold text-white underline">
              Lihat detail
            </a>
          )}
        </span>
      </button>
    </span>
  );
}

function FieldLabel({ children, tooltip, detailId }: { children: React.ReactNode; tooltip: string; detailId?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-textPrimary">
      {children}
      <HelpTooltip text={tooltip} detailId={detailId} />
    </span>
  );
}

async function copyTextWithFallback(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fallback below
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    return document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}

function Toasts() {
  const notifications = useDashboardStore((state) => state.notifications);
  const dismissNotification = useDashboardStore((state) => state.dismissNotification);

  useEffect(() => {
    const timers = notifications.map((notification) => window.setTimeout(() => dismissNotification(notification.id), 15_000));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [dismissNotification, notifications]);

  return (
    <div className="fixed right-4 top-4 z-50 grid w-[min(420px,calc(100vw-32px))] gap-3">
      {notifications.map((notification) => (
        <div key={notification.id} className={`rounded-lg border bg-surface p-4 shadow-panel ${statusClass(notification.kind)}`}>
          <div className="flex items-start gap-3">
            <Bell className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{notification.title}</p>
              <p className="mt-1 text-sm leading-5">{notification.message}</p>
            </div>
            <button
              type="button"
              className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-current/20"
              onClick={() => dismissNotification(notification.id)}
              aria-label="Tutup notifikasi"
              title="Tutup notifikasi"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function Sidebar() {
  const activeTab = useDashboardStore((state) => state.activeTab);
  const setActiveTab = useDashboardStore((state) => state.setActiveTab);

  return (
    <aside className="fixed left-0 top-0 hidden h-screen w-72 border-r border-border bg-primaryDark text-white lg:block">
      <div className="border-b border-white/15 px-6 py-5">
        <p className="text-sm font-semibold uppercase text-white/70">B-Universe</p>
        <h1 className="mt-2 text-xl font-bold leading-7">Workflow Harga Emas & Perak</h1>
      </div>
      <nav className="space-y-1 px-3 py-4">
        {menuItems.map((item) => {
          const Icon = iconMap[item as keyof typeof iconMap];
          const active = activeTab === item;
          return (
            <button
              type="button"
              key={item}
              onClick={() => setActiveTab(item)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium ${
                active ? "bg-accentRed text-white" : "text-white/80 hover:bg-white/10 hover:text-white"
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {item}
              {item === "Data Harga Emas" && (
                <HelpTooltip text="Menampilkan histori data harga emas dan fitur perbandingan antar tanggal." detailId="docs-data-harga" />
              )}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

function MobileNavigation() {
  const activeTab = useDashboardStore((state) => state.activeTab);
  const setActiveTab = useDashboardStore((state) => state.setActiveTab);
  return (
    <div className="overflow-x-auto stable-scrollbar rounded-lg border border-border bg-surface p-2 shadow-panel lg:hidden">
      <div className="flex min-w-max gap-2">
        {menuItems.map((item) => {
          const Icon = iconMap[item as keyof typeof iconMap];
          return (
            <button
              type="button"
              key={item}
              onClick={() => setActiveTab(item)}
              className={`inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold ${
                activeTab === item ? "bg-accentRed text-white" : "text-textSecondary hover:bg-background hover:text-textPrimary"
              }`}
            >
              <Icon className="h-4 w-4" />
              {item}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function useSourceOptions(portal: Portal) {
  return useQuery({
    queryKey: ["runtime-sources", portal],
    queryFn: async () => {
      const params = new URLSearchParams({ portal });
      const response = await fetch(`/api/sources?${params.toString()}`);
      const data = (await response.json()) as SourceResponse;
      if (!response.ok) throw data;
      return data.sources;
    }
  });
}

function PortalControls() {
  const portal = useDashboardStore((state) => state.portal);
  const selectedSources = useDashboardStore((state) => state.selectedSources);
  const setPortal = useDashboardStore((state) => state.setPortal);
  const setSelectedSources = useDashboardStore((state) => state.setSelectedSources);
  const sourceQuery = useSourceOptions(portal);
  const sourceOptions = sourceQuery.data ?? [];
  const activeSourceNames = selectedSources.length ? selectedSources : sourceOptions.map((source) => source.name);

  useEffect(() => {
    if (selectedSources.length && sourceOptions.length) {
      const valid = selectedSources.filter((sourceName) => sourceOptions.some((source) => source.name === sourceName));
      if (valid.length !== selectedSources.length) setSelectedSources(valid);
    }
  }, [selectedSources, setSelectedSources, sourceOptions]);

  function toggleSource(sourceName: string) {
    const next = selectedSources.includes(sourceName) ? selectedSources.filter((item) => item !== sourceName) : [...selectedSources, sourceName];
    setSelectedSources(next);
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[220px_1fr]">
      <label className="grid gap-2">
        <FieldLabel tooltip="Menentukan gaya penulisan artikel. Beritasatu cepat dan ringkas, Investor Daily analitis dan market-oriented." detailId="docs-generate">
          Portal
        </FieldLabel>
        <select
          value={portal}
          onChange={(event) => setPortal(event.target.value as Portal)}
          className="h-11 rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-primary"
        >
          {Object.keys(portalContentTypes).map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </label>
      <div className="grid gap-2">
        <FieldLabel tooltip="Memilih sumber data harga emas yang akan digunakan." detailId="docs-source-data">
          Source
        </FieldLabel>
        <div className="rounded-lg border border-border bg-surface p-3">
          <label className="flex items-center gap-2 text-sm font-semibold text-textPrimary">
            <input type="checkbox" checked={selectedSources.length === 0} onChange={() => setSelectedSources([])} />
            Semua source aktif
          </label>
          <div className="mt-2 grid max-h-32 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
            {sourceOptions.map((source) => (
              <label key={source.name} className="flex items-center gap-2 text-sm text-textSecondary">
                <input type="checkbox" checked={activeSourceNames.includes(source.name)} onChange={() => toggleSource(source.name)} />
                {source.name}
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricStrip() {
  const snapshots = useDashboardStore((state) => state.snapshots);
  const rowCount = flattenPriceRows(snapshots).filter(({ row }) => row.harga).length;
  const successCount = snapshots.filter((snapshot) => snapshot.status === "success").length;
  const errorCount = snapshots.filter((snapshot) => snapshot.status === "error").length;
  const manualCount = snapshots.filter((snapshot) => snapshot.status === "manual").length;

  const items = [
    { label: "Source valid", value: preflightRows.filter((row) => row.dataBerhasilDitarik === "Ya").length },
    { label: "Source manual", value: preflightRows.filter((row) => row.dataBerhasilDitarik === "Manual").length },
    { label: "Run sukses", value: successCount },
    { label: "Row harga", value: rowCount },
    { label: "Perlu tindak lanjut", value: errorCount + manualCount }
  ];

  return (
    <div id="overview" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {items.map((item) => (
        <div key={item.label} className="rounded-lg border border-border bg-surface p-4 shadow-panel">
          <p className="text-sm font-medium text-textSecondary">{item.label}</p>
          <p className="mt-2 text-3xl font-bold text-primary">{item.value}</p>
        </div>
      ))}
    </div>
  );
}

function PriceDataTable({ rows, emptyMessage, showContent = false }: { rows: PriceRowWithSnapshot[]; emptyMessage: string; showContent?: boolean }) {
  return (
    <div className="overflow-x-auto stable-scrollbar">
      <table className="w-full min-w-[960px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-background text-left text-textSecondary">
            <th className="px-3 py-3 font-semibold">Source</th>
            {showContent && <th className="px-3 py-3 font-semibold">Jenis Konten</th>}
            <th className="px-3 py-3 font-semibold">Kategori</th>
            <th className="px-3 py-3 font-semibold">Berat</th>
            <th className="px-3 py-3 text-right font-semibold">Harga Dasar</th>
            <th className="px-3 py-3 text-right font-semibold">Harga + Pajak PPh 0.25%</th>
            <th className="px-3 py-3 font-semibold">Update Terakhir</th>
            <th className="px-3 py-3 text-right font-semibold">
              <span className="inline-flex items-center justify-end gap-1">
                Delta
                <HelpTooltip text="Delta adalah selisih harga dibanding data terakhir yang tersimpan di sistem." detailId="docs-perbandingan" />
              </span>
            </th>
            <th className="px-3 py-3 text-right font-semibold">
              <span className="inline-flex items-center justify-end gap-1">
                % Perubahan
                <HelpTooltip text="Persentase perubahan harga dibanding data sebelumnya." detailId="docs-perbandingan" />
              </span>
            </th>
            <th className="px-3 py-3 font-semibold">Status</th>
            <th className="px-3 py-3 font-semibold">Copy</th>
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map(({ snapshot, row }) => {
              const previousText = row.previous_snapshot_run_time
                ? `(dibanding data ${formatDate(row.previous_snapshot_date)}, ${formatDateTime(row.previous_snapshot_run_time)})`
                : "Belum ada snapshot pembanding.";
              return (
                <tr key={`${snapshot.id}-${row.id}`} className="border-b border-border/70 align-top">
                  <td className="px-3 py-3 font-semibold text-primary">
                    <a href={snapshot.source_url} target="_blank" rel="noreferrer">
                      {snapshot.source_name}
                    </a>
                    <p className="mt-1 text-xs font-normal text-textSecondary">{formatDate(snapshot.tanggal_snapshot)}</p>
                  </td>
                  {showContent && <td className="px-3 py-3 text-textSecondary">{snapshot.jenis_konten}</td>}
                  <td className="px-3 py-3 text-textSecondary">{row.category ?? row.section_name ?? "-"}</td>
                  <td className="px-3 py-3 text-textSecondary">{row.berat}</td>
                  <td className="px-3 py-3 text-right font-semibold text-textPrimary">{row.base_price ? formatNumericPrice(row, row.base_price) : formatMoney(row.harga)}</td>
                  <td className="px-3 py-3 text-right font-semibold text-textPrimary">{formatNumericPrice(row, row.price_pph_025)}</td>
                  <td className="px-3 py-3 text-textSecondary">{row.waktu_update ?? snapshot.update_time ?? "-"}</td>
                  <td className={`px-3 py-3 text-right font-semibold ${deltaClass(row.delta)}`}>
                    {row.delta ?? "-"}
                    <p className="mt-1 text-xs font-normal text-textSecondary">{previousText}</p>
                  </td>
                  <td className={`px-3 py-3 text-right font-semibold ${deltaClass(row.percentage_change)}`}>{row.percentage_change ?? "-"}</td>
                  <td className="px-3 py-3">
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClass(snapshot.status)}`}>{snapshot.status}</span>
                  </td>
                  <td className="px-3 py-3">
                    <button
                      type="button"
                      className="grid h-8 w-8 place-items-center rounded-lg border border-border text-textSecondary"
                      title="Copy data"
                      aria-label="Copy data"
                      onClick={() => copyTextWithFallback(JSON.stringify({ snapshot, row }, null, 2))}
                    >
                      <Clipboard className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              );
            })
          ) : (
            <tr>
              <td colSpan={showContent ? 11 : 10} className="px-3 py-10 text-center text-textSecondary">
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function formatSourceCell(value: unknown, column: SourceDataColumn, view: SourceDataView) {
  if (value === null || value === undefined || value === "") return "-";
  if (column.type === "price") {
    if (typeof value === "number") {
      return view.currency === "USD"
        ? `US$ ${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : `Rp ${value.toLocaleString("id-ID")}`;
    }
    return formatMoney(String(value));
  }
  return String(value);
}

function sourceViewToTsv(view: SourceDataView) {
  const headers = view.columns.map((column) => column.label).join("\t");
  const rows = view.rows.map((row) => view.columns.map((column) => formatSourceCell(row[column.key], column, view)).join("\t"));
  return [`Source\t${view.source}`, `Update\t${view.update_time ?? "-"}`, `Status\t${view.status}`, "", headers, ...rows].join("\n");
}

function downloadSourceDataView(view: SourceDataView) {
  const blob = new Blob([sourceViewToTsv(view)], { type: "text/tab-separated-values;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${view.source.toLowerCase().replace(/[^a-z0-9]+/gi, "-")}-${view.run_time.slice(0, 10)}.tsv`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function SourceDataCards({ views, emptyMessage }: { views: SourceDataView[]; emptyMessage: string }) {
  const pushNotifications = useDashboardStore((state) => state.pushNotifications);

  if (!views.length) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-background p-8 text-center text-sm text-textSecondary">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {views.map((view) => (
        <article key={`${view.source}-${view.run_time}`} className="rounded-lg border border-border bg-background p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-bold text-primary">
                  <a href={view.source_url} target="_blank" rel="noreferrer">
                    {view.source}
                  </a>
                </h3>
                <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClass(view.status)}`}>
                  {view.status}
                </span>
              </div>
              <p className="mt-1 text-xs text-textSecondary">
                Update terakhir: {view.update_time ?? "-"} | Run: {formatDateTime(view.run_time)}
              </p>
              <p className="mt-1 text-xs text-textSecondary">Schema: {view.schema.length ? view.schema.join(", ") : "Tidak ada row valid"}</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-xs font-semibold text-textSecondary"
                onClick={async () => {
                  const copied = await copyTextWithFallback(sourceViewToTsv(view));
                  pushNotifications([
                    {
                      id: crypto.randomUUID(),
                      kind: copied ? "success" : "warning",
                      title: copied ? "Data tersalin" : "Copy perlu dicek",
                      message: copied ? `Data ${view.source} berhasil disalin.` : "Browser tidak mengizinkan clipboard otomatis."
                    }
                  ]);
                }}
              >
                <Clipboard className="h-4 w-4" />
                Copy
              </button>
              <button
                type="button"
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-xs font-semibold text-textSecondary"
                onClick={() => downloadSourceDataView(view)}
              >
                <Download className="h-4 w-4" />
                Export
              </button>
            </div>
          </div>

          {view.message && <p className="mt-3 rounded-md border border-border bg-surface px-3 py-2 text-xs text-textSecondary">{view.message}</p>}

          <div className="mt-3 overflow-x-auto stable-scrollbar">
            <table className="w-full min-w-[520px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-surface text-left text-textSecondary">
                  {view.columns.map((column) => (
                    <th key={column.key} className={`px-3 py-3 font-semibold ${column.align === "right" ? "text-right" : "text-left"}`}>
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {view.rows.length ? (
                  view.rows.map((row, rowIndex) => (
                    <tr key={`${view.source}-${rowIndex}`} className="border-b border-border/70 last:border-b-0">
                      {view.columns.map((column) => (
                        <td key={column.key} className={`px-3 py-3 ${column.align === "right" ? "text-right font-semibold text-textPrimary" : "text-textSecondary"}`}>
                          {formatSourceCell(row[column.key], column, view)}
                        </td>
                      ))}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={Math.max(view.columns.length, 1)} className="px-3 py-8 text-center text-textSecondary">
                      Tidak ada row valid untuk source ini.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>
      ))}
    </div>
  );
}

function SourceManagement() {
  const portal = useDashboardStore((state) => state.portal);
  const selectedSources = useDashboardStore((state) => state.selectedSources);
  const portalSourceNames = useMemo(() => [...new Set(Object.values(contentSourceMap[portal]).flat())], [portal]);
  const visibleSources = selectedSources.length ? selectedSources : portalSourceNames;

  return (
    <section className="rounded-lg border border-border bg-surface p-5 shadow-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-textPrimary">Source Management</h2>
          <p className="mt-1 text-sm text-textSecondary">Source mengikuti pilihan portal dan pengaturan admin yang sudah divalidasi.</p>
        </div>
        <span className="rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-sm font-semibold text-primary">
          {portal}
        </span>
      </div>
      <div className="mt-5 overflow-x-auto stable-scrollbar">
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-background text-left text-textSecondary">
              <th className="px-3 py-3 font-semibold">Source</th>
              <th className="px-3 py-3 font-semibold">Mode</th>
              <th className="px-3 py-3 font-semibold">Selector / Element</th>
              <th className="px-3 py-3 font-semibold">Catatan</th>
            </tr>
          </thead>
          <tbody>
            {sourceConfigs
              .filter((source) => visibleSources.includes(source.name))
              .map((source) => (
                <tr key={source.name} className="border-b border-border/70">
                  <td className="px-3 py-3 font-semibold text-textPrimary">{source.name}</td>
                  <td className="px-3 py-3">
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClass(source.mode === "otomatis" ? "success" : "manual")}`}>
                      {source.mode}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-textSecondary">{source.selectorSummary}</td>
                  <td className="px-3 py-3 text-textSecondary">{source.operationalNote ?? "Siap Run Data otomatis."}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RunDataPanel() {
  const portal = useDashboardStore((state) => state.portal);
  const selectedSources = useDashboardStore((state) => state.selectedSources);
  const snapshots = useDashboardStore((state) => state.snapshots);
  const sourceDataViews = useDashboardStore((state) => state.sourceDataViews);
  const setSnapshots = useDashboardStore((state) => state.setSnapshots);
  const setSourceDataViews = useDashboardStore((state) => state.setSourceDataViews);
  const pushNotifications = useDashboardStore((state) => state.pushNotifications);
  const visibleSourceViews = useMemo(
    () => (sourceDataViews.length ? sourceDataViews : buildSourceDataViews(snapshots)),
    [snapshots, sourceDataViews]
  );

  const runMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/run-data", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ portal, jenisKonten: SOURCE_BASED_CONTENT_LABEL, sources: selectedSources })
      });
      const data = (await response.json()) as RunDataResponse;
      if (!response.ok) throw data;
      return data;
    },
    onSuccess: (data) => {
      setSnapshots(data.snapshots);
      setSourceDataViews(data.source_views ?? buildSourceDataViews(data.snapshots));
      queryClient.invalidateQueries({ queryKey: ["history"] });
      pushNotifications(data.notifications);
    },
    onError: (error) => {
      const fallback = error as { notifications?: DashboardNotification[] };
      pushNotifications(
        fallback.notifications ?? [
          {
            id: crypto.randomUUID(),
            kind: "error",
            title: "RUN DATA gagal",
            message: "Data harga tidak dapat ditarik karena kesalahan sistem."
          }
        ]
      );
    }
  });

  return (
    <section className="rounded-lg border border-border bg-surface p-5 shadow-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="inline-flex items-center gap-2 text-lg font-bold text-textPrimary">
            Run Data
            <HelpTooltip text="Menarik data harga emas terbaru dari source yang dipilih dan menyimpannya sebagai snapshot." detailId="docs-run-data" />
          </h2>
          <p className="mt-1 text-sm text-textSecondary">
            RUN DATA bisa dipakai sendiri untuk mengambil data tanpa generate artikel.
          </p>
        </div>
        <button
          type="button"
          onClick={() => runMutation.mutate()}
          disabled={runMutation.isPending}
          className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70"
        >
          {runMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          RUN DATA
        </button>
      </div>
      <div className="mt-5">
        <SourceDataCards views={visibleSourceViews} emptyMessage="Belum ada data. Jalankan RUN DATA terlebih dahulu." />
      </div>
    </section>
  );
}

function GenerateArticlePanel() {
  const portal = useDashboardStore((state) => state.portal);
  const selectedSources = useDashboardStore((state) => state.selectedSources);
  const snapshots = useDashboardStore((state) => state.snapshots);
  const sourceDataViews = useDashboardStore((state) => state.sourceDataViews);
  const setArticle = useDashboardStore((state) => state.setArticle);
  const setSnapshots = useDashboardStore((state) => state.setSnapshots);
  const setSourceDataViews = useDashboardStore((state) => state.setSourceDataViews);
  const pushNotifications = useDashboardStore((state) => state.pushNotifications);
  const [generateMode, setGenerateMode] = useState<GenerateMode>("template");
  const [triggeredBy, setTriggeredBy] = useState(() => (typeof window === "undefined" ? "Editor Piket" : window.localStorage.getItem("editorPiket") ?? "Editor Piket"));
  const [assignedEditor, setAssignedEditor] = useState(triggeredBy);
  const [selectedDraft, setSelectedDraft] = useState<ArticleDraftRecord | null>(null);
  const [detailDraft, setDetailDraft] = useState<ArticleDraftRecord | null>(null);
  const contentLabel = sourceContextLabel(selectedSources);
  const visibleSourceViews = useMemo(
    () => (sourceDataViews.length ? sourceDataViews : buildSourceDataViews(snapshots)),
    [snapshots, sourceDataViews]
  );
  const usableSnapshots = useMemo(
    () =>
      snapshots.filter(
        (snapshot) => snapshot.status === "success" && (!selectedSources.length || selectedSources.includes(snapshot.source_name))
      ),
    [snapshots, selectedSources]
  );
  const canGenerate = Boolean(portal && usableSnapshots.length);

  const draftsQuery = useQuery({
    queryKey: ["drafts"],
    queryFn: async () => {
      const response = await fetch("/api/drafts");
      const data = (await response.json()) as DraftsResponse;
      if (!response.ok) throw data;
      return data.drafts;
    }
  });

  const runMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/run-data", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ portal, jenisKonten: SOURCE_BASED_CONTENT_LABEL, sources: selectedSources })
      });
      const data = (await response.json()) as RunDataResponse;
      if (!response.ok) throw data;
      return data;
    },
    onSuccess: (data) => {
      setSnapshots(data.snapshots);
      setSourceDataViews(data.source_views ?? buildSourceDataViews(data.snapshots));
      queryClient.invalidateQueries({ queryKey: ["history"] });
      pushNotifications(data.notifications);
    },
    onError: (error) => {
      const fallback = error as { notifications?: DashboardNotification[] };
      pushNotifications(
        fallback.notifications ?? [
          {
            id: crypto.randomUUID(),
            kind: "error",
            title: "RUN DATA gagal",
            message: "Data harga tidak dapat ditarik karena kesalahan sistem."
          }
        ]
      );
    }
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      if (!canGenerate) {
        throw {
          notifications: [
            {
              id: crypto.randomUUID(),
              kind: "warning",
              title: "Generate artikel belum aktif",
              message: "Generate artikel tidak dapat dilakukan karena data source belum berhasil dimuat."
            }
          ]
        };
      }
      if (typeof window !== "undefined") window.localStorage.setItem("editorPiket", triggeredBy);
      const response = await fetch("/api/generate-article", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ portal, jenisKonten: contentLabel, mode: generateMode, snapshots: usableSnapshots, triggeredBy, assignedEditor })
      });
      const data = (await response.json()) as GenerateArticleResponse;
      if (!response.ok) throw data;
      return data;
    },
    onSuccess: (data) => {
      setArticle(data.article ?? null);
      if (data.draft) setSelectedDraft(data.draft);
      queryClient.invalidateQueries({ queryKey: ["drafts"] });
      pushNotifications(data.notifications);
    },
    onError: (error) => {
      const payload = error as { notifications?: DashboardNotification[] };
      pushNotifications(
        payload.notifications ?? [
          {
            id: crypto.randomUUID(),
            kind: "error",
            title: "Generate artikel gagal",
            message: "Artikel tidak dapat dibuat karena kesalahan sistem."
          }
        ]
      );
    }
  });

  return (
    <section className="grid gap-5">
      <div className="rounded-lg border border-border bg-surface p-5 shadow-panel">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="inline-flex items-center gap-2 text-lg font-bold text-textPrimary">
              Generate Artikel
              <HelpTooltip text="Membuat draft artikel dari source yang dipilih dengan mode Template gratis atau AI jika billing aktif." detailId="docs-generate" />
            </h2>
            <p className="mt-1 text-sm text-textSecondary">
              Pilih portal, source, mode generate, dan editor piket. Template Mode gratis menjadi fallback utama sementara.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => runMutation.mutate()}
              disabled={runMutation.isPending}
              className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70"
            >
              {runMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Run Data
            </button>
            <button
              type="button"
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending}
              className={`inline-flex h-11 items-center gap-2 rounded-lg px-4 text-sm font-semibold ${
                canGenerate ? "bg-accentRed text-white" : "border border-border bg-background text-textSecondary"
              } disabled:cursor-not-allowed disabled:opacity-70`}
            >
              {generateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              {generateMode === "template" ? "Generate with Template" : "Generate with AI"}
            </button>
          </div>
        </div>

        <div className="mt-5">
          <PortalControls />
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-[1fr_1fr_280px]">
          <label className="grid gap-2 text-sm font-semibold text-textPrimary">
            Triggered By
            <input
              value={triggeredBy}
              onChange={(event) => {
                setTriggeredBy(event.target.value);
                if (!assignedEditor || assignedEditor === "Editor Piket") setAssignedEditor(event.target.value);
              }}
              className="h-11 rounded-lg border border-border bg-background px-3 text-sm"
              placeholder="Nama editor piket"
            />
          </label>
          <label className="grid gap-2 text-sm font-semibold text-textPrimary">
            Assigned Editor
            <input
              value={assignedEditor}
              onChange={(event) => setAssignedEditor(event.target.value)}
              className="h-11 rounded-lg border border-border bg-background px-3 text-sm"
              placeholder="Nama editor reviewer"
            />
          </label>
          <div className="grid gap-2 text-sm font-semibold text-textPrimary">
            Generate Mode
            <div className="grid grid-cols-2 rounded-lg border border-border bg-background p-1">
              {[
                { value: "template" as const, label: "Template", note: "gratis" },
                { value: "ai" as const, label: "AI", note: "OpenAI" }
              ].map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setGenerateMode(item.value)}
                  className={`rounded-md px-3 py-2 text-left text-sm font-semibold transition ${
                    generateMode === item.value ? "bg-accentRed text-white shadow-sm" : "text-textSecondary hover:bg-surface"
                  }`}
                >
                  <span className="block">{item.label}</span>
                  <span className={`block text-xs ${generateMode === item.value ? "text-white/80" : "text-textSecondary"}`}>{item.note}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-border bg-background p-4 text-sm text-textSecondary">
          <p className="font-semibold text-textPrimary">
            Mode aktif: {generateMode === "template" ? "Generate with Template" : "Generate with AI"}
          </p>
          <p className="mt-1">
            {generateMode === "template"
              ? "Template Mode tidak memakai OpenAI API dan tetap membuat draft newsroom friendly dari snapshot source."
              : "AI Mode memakai OPENAI_API_KEY. Jika billing/token belum aktif, sistem akan memberi warning dan editor bisa kembali ke Template Mode."}
          </p>
        </div>

        {!canGenerate && (
          <div className="mt-4 flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <p>Generate artikel wajib menunggu minimal satu source berhasil dimuat. Klik Run Data terlebih dahulu jika tabel masih kosong.</p>
          </div>
        )}

        <div className="mt-5">
          <SourceDataCards views={visibleSourceViews} emptyMessage="Belum ada data. Klik Run Data untuk menarik data source." />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-surface p-5 shadow-panel">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-bold text-textPrimary">Daftar Draft Artikel</h3>
          <span className="text-sm text-textSecondary">{draftsQuery.data?.length ?? 0} draft</span>
        </div>
        <div className="mt-4 overflow-x-auto stable-scrollbar">
          <table className="w-full min-w-[1180px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-background text-left text-textSecondary">
                <th className="px-3 py-3 font-semibold">Context</th>
                <th className="px-3 py-3 font-semibold">Portal</th>
                <th className="px-3 py-3 font-semibold">Judul Artikel</th>
                <th className="px-3 py-3 font-semibold">Date</th>
                <th className="px-3 py-3 font-semibold">Generated At</th>
                <th className="px-3 py-3 font-semibold">Triggered By</th>
                <th className="px-3 py-3 font-semibold">Status Data</th>
                <th className="px-3 py-3 font-semibold">Status Draft</th>
                <th className="px-3 py-3 font-semibold">Assigned Editor</th>
                <th className="px-3 py-3 font-semibold">Draft</th>
              </tr>
            </thead>
            <tbody>
              {(draftsQuery.data ?? []).map((draft) => (
                <tr key={draft.id} className="border-b border-border/70 align-top">
                  <td className="px-3 py-3 text-textSecondary">{draft.jenis_konten}</td>
                  <td className="px-3 py-3 font-semibold text-primary">{draft.portal}</td>
                  <td className="px-3 py-3 font-semibold text-textPrimary">{draft.title}</td>
                  <td className="px-3 py-3 text-textSecondary">{formatDate(draft.date)}</td>
                  <td className="px-3 py-3 text-textSecondary">{formatDateTime(draft.generated_at)}</td>
                  <td className="px-3 py-3 text-textSecondary">{draft.triggered_by}</td>
                  <td className="px-3 py-3">
                    <button type="button" onClick={() => setDetailDraft(draft)} className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClass(draft.data_status === "Success" ? "success" : draft.data_status === "Failed" ? "error" : "warning")}`}>
                      {draft.data_status}
                    </button>
                  </td>
                  <td className="px-3 py-3">
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClass(draft.status_draft === "Approved" ? "success" : draft.status_draft === "Rejected" ? "error" : draft.status_draft === "Revision Need" ? "warning" : "info")}`}>
                      {draft.status_draft}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-textSecondary">{draft.assigned_editor}</td>
                  <td className="px-3 py-3">
                    <button
                      type="button"
                      onClick={() => setSelectedDraft(draft)}
                      className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm font-semibold text-primary"
                    >
                      <Edit3 className="h-4 w-4" />
                      Edit Draft
                    </button>
                  </td>
                </tr>
              ))}
              {!draftsQuery.data?.length && (
                <tr>
                  <td colSpan={10} className="px-3 py-10 text-center text-textSecondary">
                    Belum ada draft. Jalankan Run Data lalu Generate Artikel.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedDraft && (
        <DraftEditorPanel
          draft={selectedDraft}
          onClose={() => setSelectedDraft(null)}
          onSaved={(draft) => {
            setSelectedDraft(draft);
            queryClient.invalidateQueries({ queryKey: ["drafts"] });
          }}
        />
      )}

      {detailDraft && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4">
          <div className="w-full max-w-2xl rounded-lg bg-surface p-5 shadow-panel">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-lg font-bold text-textPrimary">Detail Status Data</h3>
              <button type="button" onClick={() => setDetailDraft(null)} className="grid h-9 w-9 place-items-center rounded-lg border border-border">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 grid gap-3">
              {detailDraft.source_details.map((detail) => (
                <div key={`${detail.source_name}-${detail.status}`} className="rounded-lg border border-border bg-background p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-primary">{detail.source_name}</p>
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClass(detail.status)}`}>{detail.status}</span>
                  </div>
                  <p className="mt-2 text-sm text-textSecondary">{detail.catatan}</p>
                  <p className="mt-1 text-xs text-textSecondary">{detail.row_count} row harga</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function DraftEditorPanel({
  draft,
  onClose,
  onSaved
}: {
  draft: ArticleDraftRecord;
  onClose: () => void;
  onSaved: (draft: ArticleDraftRecord) => void;
}) {
  const pushNotifications = useDashboardStore((state) => state.pushNotifications);
  const [title, setTitle] = useState(draft.title);
  const [lead, setLead] = useState(draft.lead);
  const [bodyText, setBodyText] = useState(draft.body.join("\n\n"));
  const [status, setStatus] = useState<DraftStatus>(draft.status_draft);
  const [assignedEditor, setAssignedEditor] = useState(draft.assigned_editor);
  const [reviewNote, setReviewNote] = useState(draft.review_note ?? "");
  const [noteBy, setNoteBy] = useState(draft.review_note_updated_by ?? draft.assigned_editor);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/drafts", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: draft.id,
          title,
          lead,
          body: bodyText.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean),
          status_draft: status,
          assigned_editor: assignedEditor,
          review_note: reviewNote,
          review_note_updated_by: noteBy
        })
      });
      const data = (await response.json()) as DraftUpdateResponse;
      if (!response.ok) throw data;
      return data;
    },
    onSuccess: (data) => {
      onSaved(data.draft);
      pushNotifications(
        data.notification
          ? [data.notification]
          : [{ id: crypto.randomUUID(), kind: "success", title: "Draft tersimpan", message: "Perubahan draft berhasil disimpan." }]
      );
    },
    onError: () => {
      pushNotifications([{ id: crypto.randomUUID(), kind: "error", title: "Draft gagal disimpan", message: "Perubahan draft tidak dapat disimpan." }]);
    }
  });

  const articleText = `${title}\n\n${lead}\n\n${bodyText}`;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/40 p-4">
      <div className="mx-auto my-6 w-full max-w-5xl rounded-lg bg-surface p-5 shadow-panel">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase text-accentRed">Draft View</p>
            <h3 className="mt-1 text-xl font-bold text-textPrimary">Edit Draft Artikel</h3>
          </div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-lg border border-border">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="grid gap-3">
            <label className="grid gap-2 text-sm font-semibold text-textPrimary">
              Judul Artikel
              <input value={title} onChange={(event) => setTitle(event.target.value)} className="h-11 rounded-lg border border-border bg-background px-3 text-sm" />
            </label>
            <label className="grid gap-2 text-sm font-semibold text-textPrimary">
              Lead
              <textarea value={lead} onChange={(event) => setLead(event.target.value)} className="min-h-24 rounded-lg border border-border bg-background px-3 py-2 text-sm" />
            </label>
            <label className="grid gap-2 text-sm font-semibold text-textPrimary">
              Body Artikel
              <textarea value={bodyText} onChange={(event) => setBodyText(event.target.value)} className="min-h-[360px] rounded-lg border border-border bg-background px-3 py-2 text-sm leading-6" />
            </label>
          </div>

          <aside className="grid content-start gap-3 rounded-lg border border-border bg-background p-4">
            <label className="grid gap-2 text-sm font-semibold text-textPrimary">
              Status Draft
              <select value={status} onChange={(event) => setStatus(event.target.value as DraftStatus)} className="h-11 rounded-lg border border-border bg-surface px-3 text-sm">
                {["Pending Review", "Revision Need", "Approved", "Rejected"].map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-2 text-sm font-semibold text-textPrimary">
              Assigned Editor
              <input value={assignedEditor} onChange={(event) => setAssignedEditor(event.target.value)} className="h-11 rounded-lg border border-border bg-surface px-3 text-sm" />
            </label>
            <label className="grid gap-2 text-sm font-semibold text-textPrimary">
              Review Note / Editor Note
              <textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} className="min-h-32 rounded-lg border border-border bg-surface px-3 py-2 text-sm" placeholder="Catatan revisi, alasan reject, atau arahan angle." />
            </label>
            <label className="grid gap-2 text-sm font-semibold text-textPrimary">
              Note By
              <input value={noteBy} onChange={(event) => setNoteBy(event.target.value)} className="h-11 rounded-lg border border-border bg-surface px-3 text-sm" />
            </label>
            {draft.review_note_updated_at && (
              <p className="rounded-lg border border-border bg-surface p-3 text-xs text-textSecondary">
                Catatan terakhir: {formatDateTime(draft.review_note_updated_at)} oleh {draft.review_note_updated_by ?? "-"}
              </p>
            )}
            <button
              type="button"
              onClick={async () => {
                const copied = await copyTextWithFallback(articleText);
                pushNotifications([
                  {
                    id: crypto.randomUUID(),
                    kind: copied ? "success" : "error",
                    title: copied ? "Artikel berhasil disalin" : "Artikel gagal disalin",
                    message: copied ? "Isi artikel sudah masuk ke clipboard." : "Clipboard browser tidak dapat diakses. Silakan blok teks artikel secara manual."
                  }
                ]);
              }}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-border bg-surface px-4 text-sm font-semibold text-primary"
            >
              <Clipboard className="h-4 w-4" />
              Copy Artikel
            </button>
            <button
              type="button"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-accentRed px-4 text-sm font-semibold text-white disabled:opacity-70"
            >
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />}
              Simpan Draft
            </button>
          </aside>
        </div>
      </div>
    </div>
  );
}

function ValidationTable() {
  return (
    <section className="rounded-lg border border-border bg-surface p-5 shadow-panel">
      <h2 className="text-lg font-bold text-textPrimary">Validasi Source</h2>
      <p className="mt-1 text-sm text-textSecondary">Hasil pre-flight dari file template, Excel, dan SOURCE perbaruan.</p>
      <div className="mt-5 overflow-x-auto stable-scrollbar">
        <table className="w-full min-w-[880px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-background text-left text-textSecondary">
              <th className="px-3 py-3 font-semibold">Source</th>
              <th className="px-3 py-3 font-semibold">Status Akses</th>
              <th className="px-3 py-3 font-semibold">Element Valid</th>
              <th className="px-3 py-3 font-semibold">Data Berhasil Ditarik</th>
              <th className="px-3 py-3 font-semibold">Catatan</th>
            </tr>
          </thead>
          <tbody>
            {preflightRows.map((row) => (
              <tr key={row.source} className="border-b border-border/70">
                <td className="px-3 py-3 font-semibold text-textPrimary">{row.source}</td>
                <td className="px-3 py-3">
                  <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClass(row.statusAkses)}`}>{row.statusAkses}</span>
                </td>
                <td className="px-3 py-3">{row.elementValid}</td>
                <td className="px-3 py-3">{row.dataBerhasilDitarik}</td>
                <td className="px-3 py-3 text-textSecondary">{row.catatan}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DataHargaEmasPanel() {
  const portal = useDashboardStore((state) => state.portal);
  const selectedSources = useDashboardStore((state) => state.selectedSources);
  const snapshots = useDashboardStore((state) => state.snapshots);
  const setSnapshots = useDashboardStore((state) => state.setSnapshots);
  const setSourceDataViews = useDashboardStore((state) => state.setSourceDataViews);
  const pushNotifications = useDashboardStore((state) => state.pushNotifications);
  const [sourceFilter, setSourceFilter] = useState("Semua");
  const [dateFilter, setDateFilter] = useState("");
  const [dateA, setDateA] = useState("");
  const [dateB, setDateB] = useState("");

  const historyQuery = useQuery({
    queryKey: ["history"],
    queryFn: async () => {
      const response = await fetch("/api/history");
      const data = (await response.json()) as HistoryResponse;
      if (!response.ok) throw data;
      return data.snapshots;
    }
  });

  const runMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/run-data", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ portal, jenisKonten: SOURCE_BASED_CONTENT_LABEL, sources: selectedSources })
      });
      const data = (await response.json()) as RunDataResponse;
      if (!response.ok) throw data;
      return data;
    },
    onSuccess: (data) => {
      setSnapshots(data.snapshots);
      setSourceDataViews(data.source_views ?? buildSourceDataViews(data.snapshots));
      queryClient.invalidateQueries({ queryKey: ["history"] });
      pushNotifications(data.notifications);
    },
    onError: () => {
      pushNotifications([
        {
          id: crypto.randomUUID(),
          kind: "error",
          title: "Ambil data gagal",
          message: "Data harga tidak dapat ditarik karena kesalahan sistem."
        }
      ]);
    }
  });

  const allSnapshots = useMemo(() => dedupeSnapshots([...(snapshots ?? []), ...(historyQuery.data ?? [])]), [historyQuery.data, snapshots]);
  const sourceOptions = useMemo(() => [...new Set(allSnapshots.map((snapshot) => snapshot.source_name))], [allSnapshots]);
  const dateOptions = useMemo(() => [...new Set(allSnapshots.map((snapshot) => snapshot.tanggal_snapshot))].sort().reverse(), [allSnapshots]);
  const filteredSnapshots = useMemo(
    () =>
      allSnapshots.filter((snapshot) => {
        const sourceMatch = sourceFilter === "Semua" || snapshot.source_name === sourceFilter;
        const dateMatch = !dateFilter || snapshot.tanggal_snapshot === dateFilter;
        return sourceMatch && dateMatch;
      }),
    [allSnapshots, dateFilter, sourceFilter]
  );

  const latestBySource = useMemo(() => {
    const grouped = new Map<string, GoldPriceSnapshot>();
    for (const snapshot of [...allSnapshots].sort((a, b) => b.run_time.localeCompare(a.run_time))) {
      if (!grouped.has(snapshot.source_name)) grouped.set(snapshot.source_name, snapshot);
    }
    return [...grouped.values()];
  }, [allSnapshots]);

  const grouped = useMemo(
    () =>
      filteredSnapshots.reduce<Record<string, GoldPriceSnapshot[]>>((acc, snapshot) => {
        acc[snapshot.source_name] = [...(acc[snapshot.source_name] ?? []), snapshot];
        return acc;
      }, {}),
    [filteredSnapshots]
  );

  const comparisonRows = useMemo(() => {
    if (!dateA || !dateB) return [];
    const snapshotsA = allSnapshots.filter((snapshot) => snapshot.tanggal_snapshot === dateA && (sourceFilter === "Semua" || snapshot.source_name === sourceFilter));
    const snapshotsB = allSnapshots.filter((snapshot) => snapshot.tanggal_snapshot === dateB && (sourceFilter === "Semua" || snapshot.source_name === sourceFilter));
    const rowsA = flattenPriceRows(snapshotsA);
    const rowsB = flattenPriceRows(snapshotsB);
    return rowsA
      .map(({ snapshot, row }) => {
        const match = rowsB.find((candidate) => candidate.snapshot.source_name === snapshot.source_name && candidate.row.berat.toLowerCase() === row.berat.toLowerCase());
        if (!match) return null;
        const comparison = formatDeltaFromNumbers(match.row.harga, row.harga);
        return {
          key: `${snapshot.source_name}-${row.berat}`,
          source: snapshot.source_name,
          berat: row.berat,
          hargaA: row.harga,
          hargaB: match.row.harga,
          delta: comparison.delta,
          percentage: comparison.percentage
        };
      })
      .filter(Boolean) as Array<{ key: string; source: string; berat: string; hargaA: string | null; hargaB: string | null; delta: string | null; percentage: string | null }>;
  }, [allSnapshots, dateA, dateB, sourceFilter]);

  return (
    <section className="rounded-lg border border-border bg-surface p-5 shadow-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="inline-flex items-center gap-2 text-lg font-bold text-textPrimary">
            Data Harga Emas
            <HelpTooltip text="Menampilkan histori data harga emas dan fitur perbandingan antar tanggal." detailId="docs-data-harga" />
          </h2>
          <p className="mt-1 text-sm text-textSecondary">Pusat data untuk melihat histori, scraping manual, grouping per source, dan compare tanggal.</p>
        </div>
        <button
          type="button"
          onClick={() => runMutation.mutate()}
          disabled={runMutation.isPending}
          className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:opacity-70"
        >
          {runMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          Ambil Data Sekarang
        </button>
      </div>

      <div className="mt-5 grid gap-3 xl:grid-cols-4">
        <label className="grid gap-2">
          <FieldLabel tooltip="Memilih source untuk melihat histori atau membatasi perbandingan data." detailId="docs-source-data">
            Filter Source
          </FieldLabel>
          <select className="h-11 rounded-lg border border-border bg-background px-3 text-sm" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
            <option>Semua</option>
            {sourceOptions.map((source) => (
              <option key={source}>{source}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-sm font-semibold text-textPrimary">
          Filter Tanggal
          <input className="h-11 rounded-lg border border-border bg-background px-3 text-sm" type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} />
        </label>
        <label className="grid gap-2">
          <FieldLabel tooltip="Membandingkan harga emas antara dua tanggal yang dipilih." detailId="docs-perbandingan">
            Tanggal A
          </FieldLabel>
          <input className="h-11 rounded-lg border border-border bg-background px-3 text-sm" type="date" value={dateA} onChange={(event) => setDateA(event.target.value)} />
        </label>
        <label className="grid gap-2">
          <FieldLabel tooltip="Membandingkan harga emas antara dua tanggal yang dipilih." detailId="docs-perbandingan">
            Tanggal B
          </FieldLabel>
          <input className="h-11 rounded-lg border border-border bg-background px-3 text-sm" type="date" value={dateB} onChange={(event) => setDateB(event.target.value)} />
        </label>
      </div>

      <div className="mt-5 rounded-lg border border-border bg-background p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-base font-bold text-primary">Data Terbaru per Source</h3>
          <span className="text-sm text-textSecondary">{latestBySource.length} source</span>
        </div>
        <div className="mt-3">
          <SourceDataCards views={buildSourceDataViews(latestBySource)} emptyMessage="Belum ada data terbaru. Klik Ambil Data Sekarang." />
        </div>
      </div>

      <div className="mt-5 rounded-lg border border-border bg-background p-4">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-bold text-primary">Comparison Feature</h3>
          <HelpTooltip text="Delta membandingkan harga Tanggal B terhadap Tanggal A." detailId="docs-perbandingan" />
        </div>
        <div className="mt-3 overflow-x-auto stable-scrollbar">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-textSecondary">
                <th className="px-3 py-3 font-semibold">Source</th>
                <th className="px-3 py-3 font-semibold">Berat</th>
                <th className="px-3 py-3 text-right font-semibold">Harga Tanggal A</th>
                <th className="px-3 py-3 text-right font-semibold">Harga Tanggal B</th>
                <th className="px-3 py-3 text-right font-semibold">Delta</th>
                <th className="px-3 py-3 text-right font-semibold">% Perubahan</th>
              </tr>
            </thead>
            <tbody>
              {comparisonRows.length ? (
                comparisonRows.map((row) => (
                  <tr key={row.key} className="border-b border-border/70">
                    <td className="px-3 py-3 font-semibold text-primary">{row.source}</td>
                    <td className="px-3 py-3 text-textSecondary">{row.berat}</td>
                    <td className="px-3 py-3 text-right font-semibold text-textPrimary">{formatMoney(row.hargaA)}</td>
                    <td className="px-3 py-3 text-right font-semibold text-textPrimary">{formatMoney(row.hargaB)}</td>
                    <td className={`px-3 py-3 text-right font-semibold ${deltaClass(row.delta)}`}>{row.delta ?? "-"}</td>
                    <td className={`px-3 py-3 text-right font-semibold ${deltaClass(row.percentage)}`}>{row.percentage ?? "-"}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-textSecondary">
                    Pilih dua tanggal yang sudah memiliki snapshot untuk melihat perbandingan.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {dateOptions.length > 0 && (
          <p className="mt-3 text-xs text-textSecondary">Tanggal tersedia: {dateOptions.slice(0, 8).map(formatDate).join(", ")}</p>
        )}
      </div>

      <div className="mt-5 grid gap-4">
        {Object.entries(grouped).length ? (
          Object.entries(grouped).map(([source, sourceSnapshots]) => (
            <div key={source} className="rounded-lg border border-border bg-background p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-base font-bold text-primary">Source: {source}</h3>
                <span className="text-sm text-textSecondary">{flattenPriceRows(sourceSnapshots).length} row harga historis</span>
              </div>
              <div className="mt-3">
                <SourceDataCards views={buildSourceDataViews(sourceSnapshots)} emptyMessage="Tidak ada data untuk filter ini." />
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-lg border border-dashed border-border bg-background p-8 text-center text-sm text-textSecondary">
            Belum ada histori data. Jalankan Run Data atau Ambil Data Sekarang.
          </div>
        )}
      </div>
    </section>
  );
}

function HistoriPanel() {
  const snapshots = useDashboardStore((state) => state.snapshots);
  const latestSuccess = useMemo(() => snapshots.filter((snapshot) => snapshot.status === "success"), [snapshots]);
  return (
    <section className="rounded-lg border border-border bg-surface p-5 shadow-panel">
      <h2 className="text-lg font-bold text-textPrimary">Histori Data</h2>
      <p className="mt-1 text-sm text-textSecondary">Snapshot tidak dioverwrite. Histori lengkap juga tersedia di tab Data Harga Emas.</p>
      <div className="mt-4">
        <SourceDataCards views={buildSourceDataViews(latestSuccess)} emptyMessage="Histori sesi ini akan muncul setelah Run Data." />
      </div>
    </section>
  );
}

type DocSection = {
  id: string;
  title: string;
  body: string[];
  callouts?: Array<{ label: string; text: string; kind: "tips" | "penting" | "catatan" }>;
};

const documentationSections: DocSection[] = [
  {
    id: "docs-introduction",
    title: "Introduction",
    body: [
      "Dashboard ini dibuat untuk membantu redaksi Beritasatu dan Investor Daily mengelola konten repetitif harga emas dan perak.",
      "Pengguna utamanya adalah editor, data analyst, dan tim newsroom yang membutuhkan data harga terbaru, histori snapshot, perbandingan harga, serta draft artikel otomatis."
    ],
    callouts: [{ label: "Penting", text: "Source dan template bisa diperbarui lewat Pengaturan tanpa redeploy.", kind: "penting" }]
  },
  {
    id: "docs-cara-pakai",
    title: "Cara Menggunakan Dashboard",
    body: [
      "Flow sederhana: buka Generate Artikel, pilih portal, centang source, pilih mode generate, klik Run Data, lalu klik Generate Artikel jika artikel diperlukan.",
      "Jika editor hanya butuh tabel harga untuk pengecekan, proses berhenti setelah Run Data."
    ],
    callouts: [{ label: "Tips", text: "Centang beberapa source untuk artikel multi-source, atau kosongkan pilihan agar semua source aktif digunakan.", kind: "tips" }]
  },
  {
    id: "docs-run-data",
    title: "Run Data",
    body: [
      "Run Data menarik data harga emas terbaru dari source yang dipilih dan menyimpannya sebagai snapshot.",
      "Hasilnya berupa tabel Source, Kategori, Berat, Harga, Update Terakhir, Delta, dan Persentase Perubahan."
    ]
  },
  {
    id: "docs-generate",
    title: "Generate Artikel",
    body: [
      "Generate artikel wajib memilih portal terlebih dahulu karena gaya tulisan Beritasatu dan Investor Daily tidak dicampur.",
      "Source dan bentuk data menentukan konteks artikel. Template Mode gratis membuat narasi sederhana tanpa OpenAI API.",
      "AI Mode memakai OPENAI_API_KEY dan hanya digunakan saat editor memilih mode tersebut secara manual.",
      "Draft masuk ke tabel review dan dapat diedit lewat tombol Edit Draft."
    ],
    callouts: [{ label: "Catatan", text: "Jika AI belum aktif atau billing belum siap, gunakan Generate with Template sementara.", kind: "catatan" }]
  },
  {
    id: "docs-jenis-konten",
    title: "Source + Data Shape",
    body: [
      "Generate artikel tidak lagi bergantung pada template picker manual.",
      "Sistem membaca nama source, kolom data, daftar harga, delta, dan timestamp untuk menyusun konteks draft.",
      "Portal hanya menentukan tone: Beritasatu lebih ringkas, Investor Daily lebih analitis."
    ]
  },
  {
    id: "docs-source-data",
    title: "Source Data",
    body: [
      "Logam Mulia digunakan untuk Harga Emas dan Harga Perak Beritasatu serta Harga Emas Antam Investor Daily.",
      "Kitco, Investing, dan CNBC Metals digunakan untuk Harga Emas Dunia. CNBC saat ini dicatat manual.",
      "Pegadaian digunakan untuk artikel multi-source Antam, UBS, dan Galeri 24. Galeri24 diambil dari tabel Pegadaian.",
      "Laku Emas, Indogold, ShariaCoin, dan Treasury digunakan untuk Harga Emas Digital. Treasury saat ini manual."
    ]
  },
  {
    id: "docs-data-harga",
    title: "Data Harga Emas",
    body: [
      "Tab Data Harga Emas digunakan untuk melihat data terbaru per source, histori snapshot, grouping source, dan scraping manual lewat tombol Ambil Data Sekarang.",
      "Gunakan filter source dan tanggal untuk mempersempit tabel ketika histori sudah banyak."
    ]
  },
  {
    id: "docs-perbandingan",
    title: "Perbandingan Data",
    body: [
      "Delta adalah selisih harga dibanding data terakhir yang tersimpan di sistem.",
      "Persentase perubahan menunjukkan perubahan harga dalam persen dibanding snapshot sebelumnya atau tanggal pembanding.",
      "Pada Comparison Feature, Tanggal B dibandingkan terhadap Tanggal A."
    ]
  },
  {
    id: "docs-troubleshooting",
    title: "Troubleshooting",
    body: [
      "Jika data tidak muncul, cek apakah source dipilih benar dan source sedang aktif di Pengaturan Source.",
      "Jika source gagal load, buka Monitoring Source untuk melihat error log dan periksa selector element.",
      "Jika artikel tidak bisa generate, jalankan Run Data terlebih dahulu sampai minimal satu source berhasil."
    ],
    callouts: [{ label: "Tips", text: "Untuk source manual seperti CNBC, Treasury, Emasku, Mini Gold, dan HRTA Gold, editor tetap perlu input atau cek manual.", kind: "tips" }]
  }
];

function DocumentationPanel() {
  const [query, setQuery] = useState("");
  const [activeDoc, setActiveDoc] = useState(documentationSections[0].id);
  const filteredDocs = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return documentationSections;
    return documentationSections.filter((section) => `${section.title} ${section.body.join(" ")}`.toLowerCase().includes(keyword));
  }, [query]);

  const calloutClass = {
    tips: "border-emerald-200 bg-emerald-50 text-emerald-800",
    penting: "border-red-200 bg-red-50 text-red-800",
    catatan: "border-amber-200 bg-amber-50 text-amber-800"
  };

  return (
    <section className="rounded-lg border border-border bg-surface p-5 shadow-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-textPrimary">Documentation</h2>
          <p className="mt-1 text-sm text-textSecondary">User guide interaktif untuk editor non-technical.</p>
        </div>
        <label className="flex h-11 min-w-[280px] items-center gap-2 rounded-lg border border-border bg-background px-3">
          <Search className="h-4 w-4 text-textSecondary" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            placeholder="Search documentation"
          />
        </label>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[280px_1fr]">
        <aside className="lg:sticky lg:top-5 lg:self-start">
          <nav className="grid gap-2 rounded-lg border border-border bg-background p-3">
            {filteredDocs.map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                onClick={() => setActiveDoc(section.id)}
                className={`rounded-md px-3 py-2 text-sm font-semibold ${
                  activeDoc === section.id ? "bg-accentRed text-white" : "text-textSecondary hover:bg-surface hover:text-textPrimary"
                }`}
              >
                {section.title}
              </a>
            ))}
          </nav>
        </aside>
        <div className="grid gap-4">
          {filteredDocs.map((section) => (
            <article key={section.id} id={section.id} className="rounded-lg border border-border bg-background p-5">
              <h3 className="text-xl font-bold text-primary">{section.title}</h3>
              <div className="mt-3 grid gap-3 text-sm leading-6 text-textPrimary">
                {section.body.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
              {section.callouts?.map((callout) => (
                <div key={callout.text} className={`mt-4 rounded-lg border p-4 text-sm leading-6 ${calloutClass[callout.kind]}`}>
                  <p className="font-bold">{callout.label}</p>
                  <p className="mt-1">{callout.text}</p>
                </div>
              ))}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function SettingsPanel() {
  return (
    <div className="grid gap-5">
      <AdminCMSPanel />
      <section className="rounded-lg border border-border bg-surface p-5 shadow-panel">
        <h2 className="text-lg font-bold text-textPrimary">Deployment Public Server</h2>
        <div className="mt-4 grid gap-3 text-sm leading-6 text-textSecondary">
          <p>Project compatible dengan Vercel: Next.js App Router, API routes Node.js, Tailwind CSS, dan PostgreSQL melalui DATABASE_URL.</p>
          <p>Perubahan source dan template harian dilakukan dari Admin CMS. Perubahan UI/UX dilakukan lewat update code GitHub lalu Vercel auto redeploy.</p>
          <p>Manual source sementara: CNBC Metals, Treasury, Emasku, Mini Gold, dan HRTA Gold.</p>
        </div>
      </section>
    </div>
  );
}

function Dashboard() {
  const activeTab = useDashboardStore((state) => state.activeTab);

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <Toasts />
      <main className="lg:pl-72">
        <div className="mx-auto grid max-w-[1480px] gap-5 px-4 py-5 sm:px-6 lg:px-8">
          <header className="rounded-lg border border-border bg-surface p-5 shadow-panel">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-sm font-bold uppercase text-accentRed">Editorial Automation</p>
                <h1 className="mt-2 text-2xl font-bold text-textPrimary">Dashboard Harga Emas & Perak</h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-textSecondary">
                  Pilih portal, source, dan mode generate, lalu jalankan Run Data atau Generate Artikel dari satu workflow draft editorial.
                </p>
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">
                <Archive className="h-4 w-4" />
                Pre-flight selesai
              </div>
            </div>
            <div className="mt-5">
              <PortalControls />
            </div>
          </header>

          <MobileNavigation />

          {activeTab === "Overview" && (
            <>
              <MetricStrip />
              <ValidationTable />
              <SourceManagement />
            </>
          )}
          {activeTab === "Generate Artikel" && <GenerateArticlePanel />}
          {activeTab === "Data Harga Emas" && <DataHargaEmasPanel />}
          {activeTab === "Histori" && <HistoriPanel />}
          {activeTab === "Documentation" && <DocumentationPanel />}
          {activeTab === "Pengaturan" && <SettingsPanel />}
        </div>
      </main>
    </div>
  );
}

export default function Page() {
  return (
    <QueryClientProvider client={queryClient}>
      <Dashboard />
    </QueryClientProvider>
  );
}
