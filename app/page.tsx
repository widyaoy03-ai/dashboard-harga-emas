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
  FileText,
  HelpCircle,
  History,
  Info,
  LayoutDashboard,
  Loader2,
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
import type { DashboardNotification, GenerateArticleResponse, GoldPriceRow, GoldPriceSnapshot, Portal, RunDataResponse } from "@/lib/types";

const queryClient = new QueryClient();
const ALL_SOURCES = "Semua Source";

const iconMap = {
  Overview: LayoutDashboard,
  "Run Data": Play,
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

function useSourceOptions(portal: Portal, jenisKonten: string) {
  return useQuery({
    queryKey: ["runtime-sources", portal, jenisKonten],
    queryFn: async () => {
      const params = new URLSearchParams({ portal, jenisKonten });
      const response = await fetch(`/api/sources?${params.toString()}`);
      const data = (await response.json()) as SourceResponse;
      if (!response.ok) throw data;
      return data.sources;
    }
  });
}

function PortalControls() {
  const portal = useDashboardStore((state) => state.portal);
  const jenisKonten = useDashboardStore((state) => state.jenisKonten);
  const sourceName = useDashboardStore((state) => state.sourceName);
  const setPortal = useDashboardStore((state) => state.setPortal);
  const setJenisKonten = useDashboardStore((state) => state.setJenisKonten);
  const setSourceName = useDashboardStore((state) => state.setSourceName);
  const sourceQuery = useSourceOptions(portal, jenisKonten);
  const sourceOptions = sourceQuery.data ?? [];

  useEffect(() => {
    if (sourceName !== ALL_SOURCES && sourceOptions.length && !sourceOptions.some((source) => source.name === sourceName)) {
      setSourceName(ALL_SOURCES);
    }
  }, [setSourceName, sourceName, sourceOptions]);

  return (
    <div className="grid gap-4 xl:grid-cols-[220px_1fr_280px]">
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
      <label className="grid gap-2">
        <FieldLabel tooltip="Menentukan template artikel yang digunakan berdasarkan jenis berita emas." detailId="docs-jenis-konten">
          Jenis Konten
        </FieldLabel>
        <select
          value={jenisKonten}
          onChange={(event) => setJenisKonten(event.target.value)}
          className="h-11 rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-primary"
        >
          {portalContentTypes[portal].map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </label>
      <label className="grid gap-2">
        <FieldLabel tooltip="Memilih sumber data harga emas yang akan digunakan." detailId="docs-source-data">
          Source
        </FieldLabel>
        <select
          value={sourceName}
          onChange={(event) => setSourceName(event.target.value)}
          className="h-11 rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-primary"
        >
          <option>{ALL_SOURCES}</option>
          {sourceOptions.map((source) => (
            <option key={source.name}>{source.name}</option>
          ))}
        </select>
      </label>
    </div>
  );
}

function MetricStrip() {
  const snapshots = useDashboardStore((state) => state.snapshots);
  const rowCount = flattenPriceRows(snapshots).filter(({ row }) => row.harga || row.buyback).length;
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
            <th className="px-3 py-3 font-semibold">Berat</th>
            <th className="px-3 py-3 text-right font-semibold">Harga</th>
            <th className="px-3 py-3 text-right font-semibold">Buyback</th>
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
                  <td className="px-3 py-3 text-textSecondary">{row.berat}</td>
                  <td className="px-3 py-3 text-right font-semibold text-textPrimary">{formatMoney(row.harga)}</td>
                  <td className="px-3 py-3 text-right text-textSecondary">{formatMoney(row.buyback)}</td>
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
                      onClick={() => navigator.clipboard.writeText(JSON.stringify({ snapshot, row }, null, 2))}
                    >
                      <Clipboard className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              );
            })
          ) : (
            <tr>
              <td colSpan={showContent ? 10 : 9} className="px-3 py-10 text-center text-textSecondary">
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function SourceManagement() {
  const portal = useDashboardStore((state) => state.portal);
  const jenisKonten = useDashboardStore((state) => state.jenisKonten);
  const selectedSources = contentSourceMap[portal][jenisKonten] ?? [];

  return (
    <section className="rounded-lg border border-border bg-surface p-5 shadow-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-textPrimary">Source Management</h2>
          <p className="mt-1 text-sm text-textSecondary">Mapping source mengikuti template, Excel, dan pengaturan admin yang sudah divalidasi.</p>
        </div>
        <span className="rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-sm font-semibold text-primary">
          {portal} / {jenisKonten}
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
              .filter((source) => selectedSources.includes(source.name))
              .map((source) => (
                <tr key={source.name} className="border-b border-border/70">
                  <td className="px-3 py-3 font-semibold text-textPrimary">{source.name}</td>
                  <td className="px-3 py-3">
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClass(source.mode === "otomatis" ? "success" : "manual")}`}>
                      {source.mode}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-textSecondary">{source.selectorSummary}</td>
                  <td className="px-3 py-3 text-textSecondary">{source.operationalNote ?? "Siap RUN DATA otomatis."}</td>
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
  const jenisKonten = useDashboardStore((state) => state.jenisKonten);
  const sourceName = useDashboardStore((state) => state.sourceName);
  const snapshots = useDashboardStore((state) => state.snapshots);
  const setSnapshots = useDashboardStore((state) => state.setSnapshots);
  const pushNotifications = useDashboardStore((state) => state.pushNotifications);
  const priceRows = useMemo(() => flattenPriceRows(snapshots), [snapshots]);

  const runMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/run-data", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ portal, jenisKonten, source: sourceName })
      });
      const data = (await response.json()) as RunDataResponse;
      if (!response.ok) throw data;
      return data;
    },
    onSuccess: (data) => {
      setSnapshots(data.snapshots);
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
            RUN DATA bisa dipakai sendiri untuk mengambil data tanpa generate artikel. Source aktif: {sourceName}.
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
        <PriceDataTable rows={priceRows} emptyMessage="Belum ada data. Jalankan RUN DATA terlebih dahulu." />
      </div>
    </section>
  );
}

function GenerateArticlePanel() {
  const portal = useDashboardStore((state) => state.portal);
  const jenisKonten = useDashboardStore((state) => state.jenisKonten);
  const sourceName = useDashboardStore((state) => state.sourceName);
  const snapshots = useDashboardStore((state) => state.snapshots);
  const article = useDashboardStore((state) => state.article);
  const setArticle = useDashboardStore((state) => state.setArticle);
  const pushNotifications = useDashboardStore((state) => state.pushNotifications);
  const usableSnapshots = useMemo(
    () => snapshots.filter((snapshot) => snapshot.status === "success" && (sourceName === ALL_SOURCES || snapshot.source_name === sourceName)),
    [snapshots, sourceName]
  );
  const canGenerate = Boolean(portal && jenisKonten && usableSnapshots.length);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!canGenerate) {
        throw {
          notifications: [
            {
              id: crypto.randomUUID(),
              kind: "warning",
              title: "RUN ARTIKEL belum aktif",
              message: "Generate artikel tidak dapat dilakukan karena data source belum berhasil dimuat."
            }
          ]
        };
      }
      const response = await fetch("/api/generate-article", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ portal, jenisKonten, snapshots: usableSnapshots })
      });
      const data = (await response.json()) as GenerateArticleResponse;
      if (!response.ok) throw data;
      return data;
    },
    onSuccess: (data) => {
      setArticle(data.article ?? null);
      pushNotifications(data.notifications);
    },
    onError: (error) => {
      const payload = error as { notifications?: DashboardNotification[] };
      pushNotifications(
        payload.notifications ?? [
          {
            id: crypto.randomUUID(),
            kind: "error",
            title: "RUN ARTIKEL gagal",
            message: "Artikel tidak dapat dibuat karena kesalahan sistem."
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
            Generate Artikel
            <HelpTooltip text="Menghasilkan artikel otomatis berdasarkan data terbaru, jenis konten, dan template portal yang dipilih." detailId="docs-generate" />
          </h2>
          <p className="mt-1 text-sm text-textSecondary">
            Portal, jenis konten, dan source dipilih di header. Artikel hanya dibuat jika data sudah berhasil di-run.
          </p>
        </div>
        <button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          className={`inline-flex h-11 items-center gap-2 rounded-lg px-4 text-sm font-semibold ${
            canGenerate ? "bg-accentRed text-white" : "border border-border bg-background text-textSecondary"
          } disabled:cursor-not-allowed disabled:opacity-70`}
        >
          {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
          GENERATE ARTIKEL
        </button>
      </div>
      {!canGenerate && (
        <div className="mt-4 flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <p>Generate artikel wajib menunggu data berhasil dimuat. Jika hanya butuh data, cukup gunakan RUN DATA.</p>
        </div>
      )}
      {article && (
        <div className="mt-5 rounded-lg border border-border bg-background p-5">
          <p className="text-xs font-bold uppercase text-primary">Preview Artikel</p>
          <h3 className="mt-2 font-serifPreview text-3xl font-bold leading-tight text-textPrimary">{article.headline}</h3>
          <p className="mt-3 font-serifPreview text-lg leading-8 text-textPrimary">{article.lead}</p>
          {article.disclaimer && (
            <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
              {article.disclaimer}
            </p>
          )}
          <div className="article-preview mt-5 font-serifPreview text-base text-textPrimary">
            {article.body.map((paragraph) => (
              <p key={paragraph} className="whitespace-pre-line">
                {paragraph}
              </p>
            ))}
          </div>
          <div className="mt-5">
            <h4 className="text-sm font-bold uppercase text-primary">Rekomendasi Tambahan Angle untuk Editor</h4>
            <ul className="mt-3 grid gap-2 text-sm text-textPrimary">
              {article.rekomendasiAngle.map((angle) => (
                <li key={angle} className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  <span>{angle}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
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
  const jenisKonten = useDashboardStore((state) => state.jenisKonten);
  const sourceName = useDashboardStore((state) => state.sourceName);
  const snapshots = useDashboardStore((state) => state.snapshots);
  const setSnapshots = useDashboardStore((state) => state.setSnapshots);
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
        body: JSON.stringify({ portal, jenisKonten, source: sourceName })
      });
      const data = (await response.json()) as RunDataResponse;
      if (!response.ok) throw data;
      return data;
    },
    onSuccess: (data) => {
      setSnapshots(data.snapshots);
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
          <PriceDataTable rows={flattenPriceRows(latestBySource)} emptyMessage="Belum ada data terbaru. Klik Ambil Data Sekarang." showContent />
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
                <PriceDataTable rows={flattenPriceRows(sourceSnapshots)} emptyMessage="Tidak ada data untuk filter ini." showContent />
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-lg border border-dashed border-border bg-background p-8 text-center text-sm text-textSecondary">
            Belum ada histori data. Jalankan RUN DATA atau Ambil Data Sekarang.
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
        <PriceDataTable rows={flattenPriceRows(latestSuccess)} emptyMessage="Histori sesi ini akan muncul setelah RUN DATA." showContent />
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
      "Flow sederhana: pilih portal, pilih jenis konten, pilih source, klik RUN DATA, lalu klik GENERATE ARTIKEL jika artikel diperlukan.",
      "Jika editor hanya butuh tabel harga untuk pengecekan, proses berhenti di RUN DATA."
    ],
    callouts: [{ label: "Tips", text: "Gunakan Semua Source untuk artikel multi-source, atau pilih satu source untuk update data spesifik.", kind: "tips" }]
  },
  {
    id: "docs-run-data",
    title: "Run Data",
    body: [
      "RUN DATA menarik data harga emas terbaru dari source yang dipilih dan menyimpannya sebagai snapshot.",
      "Hasilnya berupa tabel Source, Berat, Harga, Buyback, Update Terakhir, Delta, dan Persentase Perubahan."
    ]
  },
  {
    id: "docs-generate",
    title: "Generate Artikel",
    body: [
      "Generate artikel wajib memilih portal terlebih dahulu karena gaya tulisan Beritasatu dan Investor Daily tidak dicampur.",
      "Jenis konten menentukan template artikel. Source menentukan data yang digunakan untuk narasi dan daftar harga."
    ],
    callouts: [{ label: "Catatan", text: "Jika data belum berhasil di-run, tombol generate akan memberi warning dan proses diblokir.", kind: "catatan" }]
  },
  {
    id: "docs-jenis-konten",
    title: "Jenis Konten",
    body: [
      "Harga Emas Dunia menggunakan template market/global: pembukaan kondisi global, harga spot emas, dan sentimen pasar.",
      "Harga Emas Antam menggunakan template harga harian: harga terbaru, perbandingan kemarin, dan list harga per gram.",
      "Harga Emas ANTAM, UBS, Galeri 24 menggunakan template perbandingan multi-source untuk membantu editor melihat variasi harga antar penyedia."
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
      "Jika artikel tidak bisa generate, jalankan RUN DATA terlebih dahulu sampai minimal satu source berhasil."
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
                  Pilih portal, jenis konten, dan source. RUN DATA bisa berdiri sendiri, GENERATE ARTIKEL memakai data yang sudah berhasil dimuat.
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
          {activeTab === "Run Data" && <RunDataPanel />}
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
