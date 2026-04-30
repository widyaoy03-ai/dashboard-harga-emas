"use client";

import { useEffect, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider, useMutation } from "@tanstack/react-query";
import {
  AlertTriangle,
  Archive,
  Bell,
  CheckCircle2,
  Clipboard,
  Database,
  Filter,
  FileText,
  History,
  LayoutDashboard,
  Loader2,
  Play,
  RefreshCcw,
  Settings,
  Upload,
  X,
  Zap
} from "lucide-react";
import { AdminCMSPanel } from "@/components/AdminCMSPanel";
import { contentSourceMap, menuItems, portalContentTypes, preflightRows, sourceConfigs } from "@/lib/content-framework";
import { useDashboardStore } from "@/lib/dashboard-store";
import type { DashboardNotification, GenerateArticleResponse, GoldPriceSnapshot, RunDataResponse } from "@/lib/types";

const queryClient = new QueryClient();

const iconMap = {
  Overview: LayoutDashboard,
  "Source Management": Database,
  "Run Data": Play,
  "Generate Artikel": Zap,
  "Himpunan Data Harga": Database,
  Histori: History,
  Pengaturan: Settings
};

function statusClass(status: string) {
  if (status === "success" || status === "Berhasil" || status === "Ya") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "manual" || status === "Manual" || status === "warning") return "bg-amber-50 text-amber-700 border-amber-200";
  if (status === "error" || status === "Gagal" || status === "Tidak") return "bg-red-50 text-red-700 border-red-200";
  return "bg-slate-50 text-slate-700 border-slate-200";
}

function flattenPriceRows(snapshots: GoldPriceSnapshot[]) {
  return snapshots.flatMap((snapshot) =>
    snapshot.price_rows.length
      ? snapshot.price_rows.map((row) => ({
          snapshot,
          row
        }))
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
              percentage_change: snapshot.percentage_change
            }
          }
        ]
  );
}

function Toasts() {
  const notifications = useDashboardStore((state) => state.notifications);
  const dismissNotification = useDashboardStore((state) => state.dismissNotification);

  useEffect(() => {
    const timers = notifications.map((notification) =>
      window.setTimeout(() => dismissNotification(notification.id), 15_000)
    );
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
  return (
    <aside className="fixed left-0 top-0 hidden h-screen w-72 border-r border-border bg-primaryDark text-white lg:block">
      <div className="border-b border-white/15 px-6 py-5">
        <p className="text-sm font-semibold uppercase tracking-[0.08em] text-white/70">B-Universe</p>
        <h1 className="mt-2 text-xl font-bold leading-7">Workflow Harga Emas & Perak</h1>
      </div>
      <nav className="space-y-1 px-3 py-4">
        {menuItems.map((item) => {
          const Icon = iconMap[item as keyof typeof iconMap];
          return (
            <a
              href={`#${item.toLowerCase().replaceAll(" ", "-")}`}
              key={item}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-white/80 hover:bg-white/10 hover:text-white"
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {item}
            </a>
          );
        })}
      </nav>
    </aside>
  );
}

function TabNavigation() {
  const activeTab = useDashboardStore((state) => state.activeTab);
  const setActiveTab = useDashboardStore((state) => state.setActiveTab);

  return (
    <div className="overflow-x-auto stable-scrollbar rounded-lg border border-border bg-surface p-2 shadow-panel">
      <div className="flex min-w-max gap-2">
        {menuItems.map((item) => {
          const Icon = iconMap[item as keyof typeof iconMap];
          const active = activeTab === item;
          return (
            <button
              key={item}
              type="button"
              onClick={() => setActiveTab(item)}
              className={`inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold ${
                active ? "bg-accentRed text-white" : "text-textSecondary hover:bg-background hover:text-textPrimary"
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {item}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PortalControls() {
  const portal = useDashboardStore((state) => state.portal);
  const jenisKonten = useDashboardStore((state) => state.jenisKonten);
  const setPortal = useDashboardStore((state) => state.setPortal);
  const setJenisKonten = useDashboardStore((state) => state.setJenisKonten);

  return (
    <div className="grid gap-4 md:grid-cols-[220px_1fr]">
      <label className="grid gap-2 text-sm font-semibold text-textPrimary">
        Portal
        <select
          value={portal}
          onChange={(event) => setPortal(event.target.value as typeof portal)}
          className="h-11 rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-primary"
        >
          {Object.keys(portalContentTypes).map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </label>
      <label className="grid gap-2 text-sm font-semibold text-textPrimary">
        Jenis Konten
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
    </div>
  );
}

function MetricStrip() {
  const snapshots = useDashboardStore((state) => state.snapshots);
  const successCount = snapshots.filter((snapshot) => snapshot.status === "success").length;
  const errorCount = snapshots.filter((snapshot) => snapshot.status === "error").length;
  const manualCount = snapshots.filter((snapshot) => snapshot.status === "manual").length;

  const items = [
    { label: "Source valid", value: preflightRows.filter((row) => row.dataBerhasilDitarik === "Ya").length },
    { label: "Source manual", value: preflightRows.filter((row) => row.dataBerhasilDitarik === "Manual").length },
    { label: "Run sukses", value: successCount },
    { label: "Perlu tindak lanjut", value: errorCount + manualCount }
  ];

  return (
    <div id="overview" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="rounded-lg border border-border bg-surface p-4 shadow-panel">
          <p className="text-sm font-medium text-textSecondary">{item.label}</p>
          <p className="mt-2 text-3xl font-bold text-primary">{item.value}</p>
        </div>
      ))}
    </div>
  );
}

function SourceManagement() {
  const portal = useDashboardStore((state) => state.portal);
  const jenisKonten = useDashboardStore((state) => state.jenisKonten);
  const selectedSources = contentSourceMap[portal][jenisKonten] ?? [];

  return (
    <section id="source-management" className="rounded-lg border border-border bg-surface p-5 shadow-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-textPrimary">Source Management</h2>
          <p className="mt-1 text-sm text-textSecondary">Mapping source mengikuti template dan Excel yang sudah divalidasi.</p>
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
  const snapshots = useDashboardStore((state) => state.snapshots);
  const setSnapshots = useDashboardStore((state) => state.setSnapshots);
  const pushNotifications = useDashboardStore((state) => state.pushNotifications);
  const priceRows = useMemo(() => flattenPriceRows(snapshots), [snapshots]);

  const runMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/run-data", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ portal, jenisKonten })
      });
      const data = (await response.json()) as RunDataResponse;
      if (!response.ok) throw data;
      return data;
    },
    onSuccess: (data) => {
      setSnapshots(data.snapshots);
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
    <section id="run-data" className="rounded-lg border border-border bg-surface p-5 shadow-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-textPrimary">Run Data</h2>
          <p className="mt-1 text-sm text-textSecondary">RUN DATA menarik harga terbaru, menyimpan snapshot, dan membandingkan histori.</p>
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
      <div className="mt-5 overflow-x-auto stable-scrollbar">
        <table className="w-full min-w-[1160px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-background text-left text-textSecondary">
              <th className="px-3 py-3 font-semibold">Source</th>
              <th className="px-3 py-3 font-semibold">Berat</th>
              <th className="px-3 py-3 font-semibold">Harga</th>
              <th className="px-3 py-3 font-semibold">Buyback</th>
              <th className="px-3 py-3 font-semibold">Waktu Update</th>
              <th className="px-3 py-3 font-semibold">Jam Run Sistem</th>
              <th className="px-3 py-3 font-semibold">Delta</th>
              <th className="px-3 py-3 font-semibold">Persen Perubahan</th>
              <th className="px-3 py-3 font-semibold">Status</th>
              <th className="px-3 py-3 font-semibold">Copy</th>
            </tr>
          </thead>
          <tbody>
            {priceRows.length ? (
              priceRows.map(({ snapshot, row }) => (
                <tr key={row.id} className="border-b border-border/70 align-top">
                  <td className="px-3 py-3 font-semibold text-primary">
                    <a href={snapshot.source_url} target="_blank" rel="noreferrer">
                      {snapshot.source_name}
                    </a>
                  </td>
                  <td className="px-3 py-3 text-textSecondary">{row.berat}</td>
                  <td className="px-3 py-3 font-semibold text-textPrimary">{row.harga ?? "-"}</td>
                  <td className="px-3 py-3 text-textSecondary">{row.buyback ?? "-"}</td>
                  <td className="px-3 py-3 text-textSecondary">{row.waktu_update ?? snapshot.update_time ?? "-"}</td>
                  <td className="px-3 py-3 text-textSecondary">{new Date(snapshot.run_time).toLocaleString("id-ID")}</td>
                  <td className="px-3 py-3 text-textSecondary">{row.delta ?? "-"}</td>
                  <td className="px-3 py-3 text-textSecondary">{row.percentage_change ?? "-"}</td>
                  <td className="px-3 py-3">
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClass(snapshot.status)}`}>
                      {snapshot.status}
                    </span>
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
              ))
            ) : (
              <tr>
                <td colSpan={10} className="px-3 py-10 text-center text-textSecondary">
                  Belum ada data. Jalankan RUN DATA terlebih dahulu.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function GenerateArticlePanel() {
  const portal = useDashboardStore((state) => state.portal);
  const jenisKonten = useDashboardStore((state) => state.jenisKonten);
  const snapshots = useDashboardStore((state) => state.snapshots);
  const article = useDashboardStore((state) => state.article);
  const setArticle = useDashboardStore((state) => state.setArticle);
  const pushNotifications = useDashboardStore((state) => state.pushNotifications);
  const canGenerate = Boolean(portal && jenisKonten && snapshots.some((snapshot) => snapshot.status === "success"));

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
        body: JSON.stringify({ portal, jenisKonten, snapshots })
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
    <section id="generate-artikel" className="rounded-lg border border-border bg-surface p-5 shadow-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-textPrimary">Generate Artikel</h2>
          <p className="mt-1 text-sm text-textSecondary">Gaya portal tidak dicampur: Beritasatu memakai template Beritasatu, Investor Daily memakai template Investor Daily.</p>
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
          RUN ARTIKEL
        </button>
      </div>
      {!canGenerate && (
        <div className="mt-4 flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <p>Run Artikel hanya aktif jika data sudah berhasil di-run, portal sudah dipilih, dan jenis konten sudah dipilih.</p>
        </div>
      )}
      {article && (
        <div id="preview-artikel" className="mt-5 rounded-lg border border-border bg-background p-5">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-primary">Preview Artikel</p>
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
            <h4 className="text-sm font-bold uppercase tracking-[0.08em] text-primary">Rekomendasi Tambahan Angle untuk Editor</h4>
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
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-textPrimary">Validasi Source</h2>
          <p className="mt-1 text-sm text-textSecondary">Hasil pre-flight dari file template, Excel, dan SOURCE perbaruan.</p>
        </div>
      </div>
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

function AggregationPanel() {
  const snapshots = useDashboardStore((state) => state.snapshots);
  const [sourceFilter, setSourceFilter] = useState("Semua");
  const [contentFilter, setContentFilter] = useState("Semua");
  const [dateFilter, setDateFilter] = useState("");
  const [compareA, setCompareA] = useState("");
  const [compareB, setCompareB] = useState("");

  const sourceOptions = useMemo(() => [...new Set(snapshots.map((snapshot) => snapshot.source_name))], [snapshots]);
  const contentOptions = useMemo(() => [...new Set(snapshots.map((snapshot) => snapshot.jenis_konten))], [snapshots]);
  const filteredSnapshots = useMemo(
    () =>
      snapshots.filter((snapshot) => {
        const sourceMatch = sourceFilter === "Semua" || snapshot.source_name === sourceFilter;
        const contentMatch = contentFilter === "Semua" || snapshot.jenis_konten === contentFilter;
        const dateMatch = !dateFilter || snapshot.tanggal_snapshot === dateFilter;
        return sourceMatch && contentMatch && dateMatch;
      }),
    [contentFilter, dateFilter, snapshots, sourceFilter]
  );

  const grouped = useMemo(
    () =>
      filteredSnapshots.reduce<Record<string, GoldPriceSnapshot[]>>((acc, snapshot) => {
        acc[snapshot.source_name] = [...(acc[snapshot.source_name] ?? []), snapshot];
        return acc;
      }, {}),
    [filteredSnapshots]
  );

  const compareSummary = useMemo(() => {
    if (!compareA || !compareB || compareA === compareB) return null;
    const rowA = snapshots.find((snapshot) => snapshot.source_name === compareA)?.price_rows.find((row) => row.harga);
    const rowB = snapshots.find((snapshot) => snapshot.source_name === compareB)?.price_rows.find((row) => row.harga);
    if (!rowA || !rowB) return "Data pembanding belum lengkap untuk dua source yang dipilih.";
    return `${compareA} ${rowA.berat}: ${rowA.harga}. ${compareB} ${rowB.berat}: ${rowB.harga}.`;
  }, [compareA, compareB, snapshots]);

  return (
    <section id="himpunan-data-harga" className="rounded-lg border border-border bg-surface p-5 shadow-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-textPrimary">Himpunan Data Harga</h2>
          <p className="mt-1 text-sm text-textSecondary">Agregasi semua data harga per source untuk filter, review, dan bahan artikel multi-source.</p>
        </div>
        <Filter className="h-5 w-5 text-accentRed" aria-hidden="true" />
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-4">
        <label className="grid gap-2 text-sm font-semibold text-textPrimary">
          Source
          <select className="h-11 rounded-lg border border-border bg-background px-3 text-sm" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
            <option>Semua</option>
            {sourceOptions.map((source) => (
              <option key={source}>{source}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-sm font-semibold text-textPrimary">
          Jenis Konten
          <select className="h-11 rounded-lg border border-border bg-background px-3 text-sm" value={contentFilter} onChange={(event) => setContentFilter(event.target.value)}>
            <option>Semua</option>
            {contentOptions.map((content) => (
              <option key={content}>{content}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-sm font-semibold text-textPrimary">
          Tanggal
          <input className="h-11 rounded-lg border border-border bg-background px-3 text-sm" type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-textPrimary">
          Jumlah Row
          <input className="h-11 rounded-lg border border-border bg-background px-3 text-sm" readOnly value={flattenPriceRows(filteredSnapshots).length} />
        </label>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-[1fr_1fr_auto]">
        <select className="h-11 rounded-lg border border-border bg-background px-3 text-sm" value={compareA} onChange={(event) => setCompareA(event.target.value)}>
          <option value="">Compare source A</option>
          {sourceOptions.map((source) => (
            <option key={source}>{source}</option>
          ))}
        </select>
        <select className="h-11 rounded-lg border border-border bg-background px-3 text-sm" value={compareB} onChange={(event) => setCompareB(event.target.value)}>
          <option value="">Compare source B</option>
          {sourceOptions.map((source) => (
            <option key={source}>{source}</option>
          ))}
        </select>
        <div className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-textSecondary">
          {compareSummary ?? "Pilih dua source untuk compare antar source."}
        </div>
      </div>

      <div className="mt-5 grid gap-4">
        {Object.entries(grouped).length ? (
          Object.entries(grouped).map(([source, sourceSnapshots]) => (
            <div key={source} className="rounded-lg border border-border bg-background p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-base font-bold text-primary">Source: {source}</h3>
                <span className="text-sm text-textSecondary">{flattenPriceRows(sourceSnapshots).length} row harga</span>
              </div>
              <div className="mt-3 overflow-x-auto stable-scrollbar">
                <table className="w-full min-w-[760px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-textSecondary">
                      <th className="px-3 py-2 font-semibold">Jenis Konten</th>
                      <th className="px-3 py-2 font-semibold">Berat</th>
                      <th className="px-3 py-2 font-semibold">Harga</th>
                      <th className="px-3 py-2 font-semibold">Buyback</th>
                      <th className="px-3 py-2 font-semibold">Update</th>
                      <th className="px-3 py-2 font-semibold">Delta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flattenPriceRows(sourceSnapshots).map(({ snapshot, row }) => (
                      <tr key={row.id} className="border-b border-border/70">
                        <td className="px-3 py-2 text-textSecondary">{snapshot.jenis_konten}</td>
                        <td className="px-3 py-2 text-textSecondary">{row.berat}</td>
                        <td className="px-3 py-2 font-semibold text-textPrimary">{row.harga ?? "-"}</td>
                        <td className="px-3 py-2 text-textSecondary">{row.buyback ?? "-"}</td>
                        <td className="px-3 py-2 text-textSecondary">{row.waktu_update ?? "-"}</td>
                        <td className="px-3 py-2 text-textSecondary">{row.delta ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-lg border border-dashed border-border bg-background p-8 text-center text-sm text-textSecondary">
            Belum ada himpunan data. Jalankan RUN DATA untuk mengisi agregasi harga.
          </div>
        )}
      </div>
    </section>
  );
}

function SupportingPanels({ mode }: { mode: "histori" | "pengaturan" }) {
  const snapshots = useDashboardStore((state) => state.snapshots);
  const latestSuccess = useMemo(() => snapshots.filter((snapshot) => snapshot.status === "success"), [snapshots]);
  const [uploadResult, setUploadResult] = useState<string>("Belum ada file baru yang diproses.");

  async function handleUpload(file: File | undefined) {
    if (!file) return;
    const form = new FormData();
    form.set("file", file);
    const response = await fetch("/api/upload-template", { method: "POST", body: form });
    const data = await response.json();
    setUploadResult(data.ok ? `File ${file.name} berhasil dibaca.` : data.message);
  }

  return (
    <div className={mode === "pengaturan" ? "grid gap-5" : "grid gap-5 xl:grid-cols-2"}>
      {mode === "histori" && (
        <>
          <section id="histori-data" className="rounded-lg border border-border bg-surface p-5 shadow-panel">
            <h2 className="text-lg font-bold text-textPrimary">Histori Data</h2>
            <p className="mt-1 text-sm text-textSecondary">Snapshot tidak dioverwrite. Database PostgreSQL siap melalui DATABASE_URL.</p>
            <div className="mt-4 grid gap-3">
              {latestSuccess.slice(0, 4).map((snapshot) => (
                <div key={snapshot.id} className="rounded-lg border border-border bg-background p-3">
                  <p className="text-sm font-semibold text-textPrimary">{snapshot.source_name}</p>
                  <p className="mt-1 text-sm text-textSecondary">
                    {snapshot.tanggal_snapshot} / {snapshot.harga_terbaru} / {snapshot.price_rows.length} row
                  </p>
                </div>
              ))}
              {!latestSuccess.length && <p className="text-sm text-textSecondary">Histori akan muncul setelah RUN DATA.</p>}
            </div>
          </section>
          <section id="compare-tanggal" className="rounded-lg border border-border bg-surface p-5 shadow-panel">
            <h2 className="text-lg font-bold text-textPrimary">Compare Tanggal</h2>
            <p className="mt-1 text-sm text-textSecondary">Perbandingan otomatis aktif setelah snapshot hari sebelumnya tersedia.</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <input className="h-11 rounded-lg border border-border bg-background px-3 text-sm" type="date" />
              <input className="h-11 rounded-lg border border-border bg-background px-3 text-sm" type="date" />
            </div>
          </section>
        </>
      )}
      {mode === "pengaturan" && (
        <>
          <AdminCMSPanel />
          <section className="rounded-lg border border-border bg-surface p-5 shadow-panel">
            <h2 className="text-lg font-bold text-textPrimary">Deployment Public Server</h2>
            <div className="mt-4 grid gap-3 text-sm leading-6 text-textSecondary">
              <p>Project compatible dengan Vercel: Next.js App Router, API routes Node.js, Tailwind CSS, dan PostgreSQL melalui DATABASE_URL.</p>
              <p>Setelah deploy, perubahan source dan template dilakukan dari Admin CMS, disimpan ke database, lalu langsung dipakai RUN DATA dan RUN ARTIKEL tanpa rebuild.</p>
              <p>Untuk proteksi panel admin di URL publik, set env ADMIN_TOKEN di Vercel lalu isi token yang sama di field ADMIN_TOKEN dashboard.</p>
              <p>Manual source sementara: CNBC Metals, Treasury, Emasku, Mini Gold, dan HRTA Gold.</p>
            </div>
          </section>
        </>
      )}
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
                <p className="text-sm font-bold uppercase tracking-[0.12em] text-accentRed">Editorial Automation</p>
                <h1 className="mt-2 text-2xl font-bold text-textPrimary">Dashboard Harga Emas & Perak</h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-textSecondary">
                  Sistem menunggu RUN DATA sebelum RUN ARTIKEL, memisahkan style Beritasatu dan Investor Daily, serta menampilkan notifikasi jika source gagal.
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
          <TabNavigation />
          {activeTab === "Overview" && (
            <>
              <MetricStrip />
              <ValidationTable />
              <SourceManagement />
            </>
          )}
          {activeTab === "Run Data" && <RunDataPanel />}
          {activeTab === "Generate Artikel" && <GenerateArticlePanel />}
          {activeTab === "Himpunan Data Harga" && <AggregationPanel />}
          {activeTab === "Histori" && <SupportingPanels mode="histori" />}
          {activeTab === "Pengaturan" && <SupportingPanels mode="pengaturan" />}
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
