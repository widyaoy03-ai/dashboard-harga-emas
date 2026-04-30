"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, FileText, KeyRound, Plus, Save, UploadCloud } from "lucide-react";
import { portalContentTypes } from "@/lib/content-framework";
import { useDashboardStore } from "@/lib/dashboard-store";
import type {
  AdminSourceRecord,
  ArticleTemplateRecord,
  DashboardNotification,
  HistoryUploadRecord,
  Portal,
  SourceContentMapping,
  SourceMonitorLog
} from "@/lib/types";

type AdminTab = "Pengaturan Source" | "Template Artikel" | "Upload Histori" | "Monitoring Source";

type AdminSourcesResponse = {
  ok: boolean;
  sources: AdminSourceRecord[];
  message?: string;
};

type AdminTemplatesResponse = {
  ok: boolean;
  templates: ArticleTemplateRecord[];
  message?: string;
};

type AdminHistoryResponse = {
  ok: boolean;
  uploads: HistoryUploadRecord[];
  message?: string;
};

type AdminMonitoringResponse = {
  ok: boolean;
  logs: SourceMonitorLog[];
  message?: string;
};

const adminTabs: AdminTab[] = ["Pengaturan Source", "Template Artikel", "Upload Histori", "Monitoring Source"];

const emptySource: AdminSourceRecord = {
  id: "",
  name: "",
  url: "",
  mode: "otomatis",
  group: "manual",
  selectorSummary: "",
  titleSelector: "",
  dataSelector: "",
  timestampSelector: "",
  elementKeywords: [],
  priceCurrency: "IDR",
  operationalNote: "",
  is_active: true,
  content_mapping: []
};

const emptyTemplate: ArticleTemplateRecord = {
  id: "",
  portal: "Investor Daily",
  jenis_konten: "Harga Emas Dunia",
  headline_template: "{jenis_konten} Hari Ini, {tanggal}: {gerak}",
  body_template:
    "{dateline} - {jenis_konten} menjadi perhatian investor pada {tanggal}. Data terbaru dari {source} menunjukkan harga utama berada di {harga_utama} untuk {berat}.",
  source_mapping: [],
  example_patterns: [],
  is_active: true
};

function splitInput(value: string) {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function mappingKey(mapping: SourceContentMapping) {
  return `${mapping.portal}::${mapping.jenis_konten}`;
}

function statusClass(status: string) {
  if (status === "success") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "manual" || status === "warning") return "border-amber-200 bg-amber-50 text-amber-700";
  if (status === "error") return "border-red-200 bg-red-50 text-red-700";
  return "border-border bg-background text-textSecondary";
}

function adminHeaders(token: string, json = true): HeadersInit {
  const headers: Record<string, string> = {};
  if (json) headers["content-type"] = "application/json";
  if (token) headers["x-admin-token"] = token;
  return headers;
}

async function readResponse<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok) throw data;
  return data as T;
}

export function AdminCMSPanel() {
  const queryClient = useQueryClient();
  const pushNotifications = useDashboardStore((state) => state.pushNotifications);
  const [activeAdminTab, setActiveAdminTab] = useState<AdminTab>("Pengaturan Source");
  const [adminToken, setAdminToken] = useState(() =>
    typeof window === "undefined" ? "" : window.localStorage.getItem("adminToken") ?? ""
  );
  const [sourceForm, setSourceForm] = useState<AdminSourceRecord>(emptySource);
  const [templateForm, setTemplateForm] = useState<ArticleTemplateRecord>(emptyTemplate);
  const [historyMode, setHistoryMode] = useState<"append" | "replace">("append");
  const [historyFile, setHistoryFile] = useState<File | null>(null);

  const mappings = useMemo(
    () =>
      (Object.entries(portalContentTypes) as [Portal, string[]][]).flatMap(([portal, contentTypes]) =>
        contentTypes.map<SourceContentMapping>((jenisKonten) => ({ portal, jenis_konten: jenisKonten }))
      ),
    []
  );

  const sourceQuery = useQuery({
    queryKey: ["admin-sources", adminToken],
    queryFn: async () => readResponse<AdminSourcesResponse>(await fetch("/api/admin/sources", { headers: adminHeaders(adminToken, false) }))
  });

  const templateQuery = useQuery({
    queryKey: ["admin-templates", adminToken],
    queryFn: async () => readResponse<AdminTemplatesResponse>(await fetch("/api/admin/templates", { headers: adminHeaders(adminToken, false) }))
  });

  const historyQuery = useQuery({
    queryKey: ["admin-history", adminToken],
    queryFn: async () => readResponse<AdminHistoryResponse>(await fetch("/api/admin/history", { headers: adminHeaders(adminToken, false) }))
  });

  const monitoringQuery = useQuery({
    queryKey: ["admin-monitoring", adminToken],
    queryFn: async () => readResponse<AdminMonitoringResponse>(await fetch("/api/admin/monitoring", { headers: adminHeaders(adminToken, false) }))
  });

  function handleTokenChange(value: string) {
    setAdminToken(value);
    if (typeof window !== "undefined") window.localStorage.setItem("adminToken", value);
  }

  function pushApiNotification(payload: { notification?: DashboardNotification; message?: string }, fallback: DashboardNotification) {
    pushNotifications(payload.notification ? [payload.notification] : [fallback]);
  }

  const saveSourceMutation = useMutation({
    mutationFn: async () => {
      const body = {
        ...sourceForm,
        id: sourceForm.id || undefined,
        name: sourceForm.name.trim(),
        url: sourceForm.url.trim(),
        selectorSummary: sourceForm.selectorSummary.trim(),
        titleSelector: sourceForm.titleSelector?.trim() || undefined,
        dataSelector: sourceForm.dataSelector?.trim() || undefined,
        timestampSelector: sourceForm.timestampSelector?.trim() || undefined,
        operationalNote: sourceForm.operationalNote?.trim() || undefined,
        elementKeywords: sourceForm.elementKeywords
      };
      return readResponse<{ ok: boolean; source: AdminSourceRecord; notification?: DashboardNotification }>(
        await fetch("/api/admin/sources", {
          method: "POST",
          headers: adminHeaders(adminToken),
          body: JSON.stringify(body)
        })
      );
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["admin-sources"] });
      setSourceForm(data.source);
      pushApiNotification(data, {
        id: crypto.randomUUID(),
        kind: "success",
        title: "Source tersimpan",
        message: "Pengaturan source berhasil disimpan."
      });
    },
    onError: (error) => {
      const payload = error as { message?: string };
      pushNotifications([
        {
          id: crypto.randomUUID(),
          kind: "error",
          title: "Source gagal disimpan",
          message: payload.message ?? "Periksa ADMIN_TOKEN atau format data source."
        }
      ]);
    }
  });

  const saveTemplateMutation = useMutation({
    mutationFn: async () =>
      readResponse<{ ok: boolean; template: ArticleTemplateRecord; notification?: DashboardNotification }>(
        await fetch("/api/admin/templates", {
          method: "POST",
          headers: adminHeaders(adminToken),
          body: JSON.stringify({
            ...templateForm,
            id: templateForm.id || undefined,
            source_mapping: templateForm.source_mapping,
            example_patterns: templateForm.example_patterns
          })
        })
      ),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["admin-templates"] });
      setTemplateForm(data.template);
      pushApiNotification(data, {
        id: crypto.randomUUID(),
        kind: "success",
        title: "Template tersimpan",
        message: "Template artikel berhasil disimpan."
      });
    },
    onError: (error) => {
      const payload = error as { message?: string };
      pushNotifications([
        {
          id: crypto.randomUUID(),
          kind: "error",
          title: "Template gagal disimpan",
          message: payload.message ?? "Periksa ADMIN_TOKEN atau isi template."
        }
      ]);
    }
  });

  const uploadHistoryMutation = useMutation({
    mutationFn: async () => {
      if (!historyFile) throw new Error("Pilih file histori terlebih dahulu.");
      const form = new FormData();
      form.set("file", historyFile);
      form.set("mode", historyMode);
      return readResponse<{ ok: boolean; upload: HistoryUploadRecord; notification?: DashboardNotification }>(
        await fetch("/api/admin/history", {
          method: "POST",
          headers: adminHeaders(adminToken, false),
          body: form
        })
      );
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["admin-history"] });
      pushApiNotification(data, {
        id: crypto.randomUUID(),
        kind: "success",
        title: "Histori tersimpan",
        message: "File histori berhasil diproses."
      });
    },
    onError: (error) => {
      const payload = error as { message?: string };
      pushNotifications([
        {
          id: crypto.randomUUID(),
          kind: "error",
          title: "Upload histori gagal",
          message: payload.message ?? "File histori gagal diproses."
        }
      ]);
    }
  });

  const monitoringMutation = useMutation({
    mutationFn: async () =>
      readResponse<{ ok: boolean; logs: SourceMonitorLog[]; notification?: DashboardNotification }>(
        await fetch("/api/admin/monitoring", {
          method: "POST",
          headers: adminHeaders(adminToken, false)
        })
      ),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["admin-monitoring"] });
      pushApiNotification(data, {
        id: crypto.randomUUID(),
        kind: data.ok ? "success" : "warning",
        title: "Monitoring selesai",
        message: "Status source berhasil diperbarui."
      });
    },
    onError: (error) => {
      const payload = error as { message?: string };
      pushNotifications([
        {
          id: crypto.randomUUID(),
          kind: "error",
          title: "Monitoring gagal",
          message: payload.message ?? "Monitoring source tidak dapat dijalankan."
        }
      ]);
    }
  });

  function toggleMapping(mapping: SourceContentMapping) {
    const key = mappingKey(mapping);
    const exists = sourceForm.content_mapping.some((item) => mappingKey(item) === key);
    setSourceForm({
      ...sourceForm,
      content_mapping: exists ? sourceForm.content_mapping.filter((item) => mappingKey(item) !== key) : [...sourceForm.content_mapping, mapping]
    });
  }

  return (
    <section id="pengaturan" className="rounded-lg border border-border bg-surface p-5 shadow-panel">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-textPrimary">Admin CMS Internal</h2>
          <p className="mt-1 text-sm text-textSecondary">
            Source, template, histori, dan monitoring bisa diperbarui dari dashboard dan langsung dipakai sistem tanpa redeploy.
          </p>
        </div>
        <label className="grid min-w-[260px] gap-2 text-sm font-semibold text-textPrimary">
          ADMIN_TOKEN
          <span className="flex h-11 items-center gap-2 rounded-lg border border-border bg-background px-3">
            <KeyRound className="h-4 w-4 text-textSecondary" aria-hidden="true" />
            <input
              value={adminToken}
              onChange={(event) => handleTokenChange(event.target.value)}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              type="password"
              placeholder="Kosong jika belum diset"
            />
          </span>
        </label>
      </div>

      <div className="mt-5 overflow-x-auto stable-scrollbar">
        <div className="flex min-w-max gap-2">
          {adminTabs.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveAdminTab(tab)}
              className={`h-10 rounded-lg px-3 text-sm font-semibold ${
                activeAdminTab === tab ? "bg-accentRed text-white" : "border border-border bg-background text-textSecondary"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {activeAdminTab === "Pengaturan Source" && (
        <div className="mt-5 grid gap-5 xl:grid-cols-[420px_1fr]">
          <div className="rounded-lg border border-border bg-background p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-base font-bold text-primary">Form Source</h3>
              <button
                type="button"
                onClick={() => setSourceForm(emptySource)}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm font-semibold text-textSecondary"
              >
                <Plus className="h-4 w-4" />
                Baru
              </button>
            </div>
            <div className="mt-4 grid gap-3">
              <input
                value={sourceForm.name}
                onChange={(event) => setSourceForm({ ...sourceForm, name: event.target.value })}
                className="h-11 rounded-lg border border-border bg-surface px-3 text-sm"
                placeholder="Nama source"
              />
              <input
                value={sourceForm.url}
                onChange={(event) => setSourceForm({ ...sourceForm, url: event.target.value })}
                className="h-11 rounded-lg border border-border bg-surface px-3 text-sm"
                placeholder="Source URL"
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <select
                  value={sourceForm.mode}
                  onChange={(event) => setSourceForm({ ...sourceForm, mode: event.target.value as AdminSourceRecord["mode"] })}
                  className="h-11 rounded-lg border border-border bg-surface px-3 text-sm"
                >
                  <option value="otomatis">otomatis</option>
                  <option value="manual">manual</option>
                </select>
                <select
                  value={sourceForm.priceCurrency}
                  onChange={(event) => setSourceForm({ ...sourceForm, priceCurrency: event.target.value as AdminSourceRecord["priceCurrency"] })}
                  className="h-11 rounded-lg border border-border bg-surface px-3 text-sm"
                >
                  <option value="IDR">IDR</option>
                  <option value="USD">USD</option>
                </select>
              </div>
              <select
                value={sourceForm.group}
                onChange={(event) => setSourceForm({ ...sourceForm, group: event.target.value as AdminSourceRecord["group"] })}
                className="h-11 rounded-lg border border-border bg-surface px-3 text-sm"
              >
                {["antam", "perak", "dunia", "perhiasan", "pegadaian", "digital", "emas-kecil", "manual"].map((group) => (
                  <option key={group}>{group}</option>
                ))}
              </select>
              <input
                value={sourceForm.selectorSummary}
                onChange={(event) => setSourceForm({ ...sourceForm, selectorSummary: event.target.value })}
                className="h-11 rounded-lg border border-border bg-surface px-3 text-sm"
                placeholder="Ringkasan selector"
              />
              <input
                value={sourceForm.titleSelector ?? ""}
                onChange={(event) => setSourceForm({ ...sourceForm, titleSelector: event.target.value })}
                className="h-11 rounded-lg border border-border bg-surface px-3 text-sm"
                placeholder="Element judul data"
              />
              <input
                value={sourceForm.dataSelector ?? ""}
                onChange={(event) => setSourceForm({ ...sourceForm, dataSelector: event.target.value })}
                className="h-11 rounded-lg border border-border bg-surface px-3 text-sm"
                placeholder="Element data / selector tabel"
              />
              <input
                value={sourceForm.timestampSelector ?? ""}
                onChange={(event) => setSourceForm({ ...sourceForm, timestampSelector: event.target.value })}
                className="h-11 rounded-lg border border-border bg-surface px-3 text-sm"
                placeholder="Element timestamp"
              />
              <textarea
                value={sourceForm.elementKeywords.join("\n")}
                onChange={(event) => setSourceForm({ ...sourceForm, elementKeywords: splitInput(event.target.value) })}
                className="min-h-24 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                placeholder="Keyword validasi element, satu per baris"
              />
              <textarea
                value={sourceForm.operationalNote ?? ""}
                onChange={(event) => setSourceForm({ ...sourceForm, operationalNote: event.target.value })}
                className="min-h-20 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                placeholder="Catatan operasional"
              />
              <label className="flex items-center gap-2 text-sm font-semibold text-textPrimary">
                <input
                  type="checkbox"
                  checked={sourceForm.is_active}
                  onChange={(event) => setSourceForm({ ...sourceForm, is_active: event.target.checked })}
                />
                Source aktif
              </label>
              <div className="rounded-lg border border-border bg-surface p-3">
                <p className="text-sm font-bold text-textPrimary">Mapping Jenis Konten</p>
                <div className="mt-3 grid gap-2">
                  {mappings.map((mapping) => (
                    <label key={mappingKey(mapping)} className="flex items-center gap-2 text-sm text-textSecondary">
                      <input
                        type="checkbox"
                        checked={sourceForm.content_mapping.some((item) => mappingKey(item) === mappingKey(mapping))}
                        onChange={() => toggleMapping(mapping)}
                      />
                      {mapping.portal} / {mapping.jenis_konten}
                    </label>
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={() => saveSourceMutation.mutate()}
                disabled={saveSourceMutation.isPending}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:opacity-70"
              >
                <Save className="h-4 w-4" />
                Simpan Source
              </button>
            </div>
          </div>

          <div className="overflow-x-auto stable-scrollbar">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-background text-left text-textSecondary">
                  <th className="px-3 py-3 font-semibold">Source</th>
                  <th className="px-3 py-3 font-semibold">Mode</th>
                  <th className="px-3 py-3 font-semibold">Status</th>
                  <th className="px-3 py-3 font-semibold">Mapping</th>
                  <th className="px-3 py-3 font-semibold">Selector</th>
                  <th className="px-3 py-3 font-semibold">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {(sourceQuery.data?.sources ?? []).map((source) => (
                  <tr key={source.id} className="border-b border-border/70 align-top">
                    <td className="px-3 py-3">
                      <p className="font-semibold text-primary">{source.name}</p>
                      <p className="mt-1 max-w-[260px] truncate text-xs text-textSecondary">{source.url}</p>
                    </td>
                    <td className="px-3 py-3 text-textSecondary">{source.mode}</td>
                    <td className="px-3 py-3">
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${source.is_active ? statusClass("success") : statusClass("warning")}`}>
                        {source.is_active ? "aktif" : "nonaktif"}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-textSecondary">{source.content_mapping.length} jenis konten</td>
                    <td className="px-3 py-3 text-textSecondary">{source.selectorSummary}</td>
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        onClick={() => setSourceForm(source)}
                        className="h-9 rounded-lg border border-border px-3 text-sm font-semibold text-primary"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
                {sourceQuery.isError && (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-sm text-red-700">
                      Data source tidak dapat dimuat. Isi ADMIN_TOKEN jika proteksi admin aktif.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeAdminTab === "Template Artikel" && (
        <div className="mt-5 grid gap-5 xl:grid-cols-[420px_1fr]">
          <div className="rounded-lg border border-border bg-background p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-base font-bold text-primary">Form Template</h3>
              <button
                type="button"
                onClick={() => setTemplateForm(emptyTemplate)}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm font-semibold text-textSecondary"
              >
                <Plus className="h-4 w-4" />
                Baru
              </button>
            </div>
            <div className="mt-4 grid gap-3">
              <select
                value={templateForm.portal}
                onChange={(event) => {
                  const portal = event.target.value as Portal;
                  setTemplateForm({ ...templateForm, portal, jenis_konten: portalContentTypes[portal][0] });
                }}
                className="h-11 rounded-lg border border-border bg-surface px-3 text-sm"
              >
                <option>Investor Daily</option>
                <option>Beritasatu</option>
              </select>
              <select
                value={templateForm.jenis_konten}
                onChange={(event) => setTemplateForm({ ...templateForm, jenis_konten: event.target.value })}
                className="h-11 rounded-lg border border-border bg-surface px-3 text-sm"
              >
                {portalContentTypes[templateForm.portal].map((contentType) => (
                  <option key={contentType}>{contentType}</option>
                ))}
              </select>
              <input
                value={templateForm.headline_template}
                onChange={(event) => setTemplateForm({ ...templateForm, headline_template: event.target.value })}
                className="h-11 rounded-lg border border-border bg-surface px-3 text-sm"
                placeholder="Headline template"
              />
              <textarea
                value={templateForm.body_template}
                onChange={(event) => setTemplateForm({ ...templateForm, body_template: event.target.value })}
                className="min-h-36 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                placeholder="Body template dengan placeholder {dateline}, {jenis_konten}, {tanggal}, {source}, {harga_utama}, {berat}"
              />
              <textarea
                value={templateForm.source_mapping.join("\n")}
                onChange={(event) => setTemplateForm({ ...templateForm, source_mapping: splitInput(event.target.value) })}
                className="min-h-20 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                placeholder="Source mapping, satu per baris"
              />
              <textarea
                value={templateForm.example_patterns.join("\n")}
                onChange={(event) => setTemplateForm({ ...templateForm, example_patterns: splitInput(event.target.value) })}
                className="min-h-24 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                placeholder="Contoh pola judul, satu per baris"
              />
              <label className="flex items-center gap-2 text-sm font-semibold text-textPrimary">
                <input
                  type="checkbox"
                  checked={templateForm.is_active}
                  onChange={(event) => setTemplateForm({ ...templateForm, is_active: event.target.checked })}
                />
                Template aktif
              </label>
              <button
                type="button"
                onClick={() => saveTemplateMutation.mutate()}
                disabled={saveTemplateMutation.isPending}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:opacity-70"
              >
                <FileText className="h-4 w-4" />
                Simpan Template
              </button>
            </div>
          </div>

          <div className="overflow-x-auto stable-scrollbar">
            <table className="w-full min-w-[860px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-background text-left text-textSecondary">
                  <th className="px-3 py-3 font-semibold">Portal</th>
                  <th className="px-3 py-3 font-semibold">Jenis Konten</th>
                  <th className="px-3 py-3 font-semibold">Headline</th>
                  <th className="px-3 py-3 font-semibold">Status</th>
                  <th className="px-3 py-3 font-semibold">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {(templateQuery.data?.templates ?? []).map((template) => (
                  <tr key={template.id} className="border-b border-border/70 align-top">
                    <td className="px-3 py-3 font-semibold text-primary">{template.portal}</td>
                    <td className="px-3 py-3 text-textSecondary">{template.jenis_konten}</td>
                    <td className="px-3 py-3 text-textSecondary">{template.headline_template}</td>
                    <td className="px-3 py-3">
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${template.is_active ? statusClass("success") : statusClass("warning")}`}>
                        {template.is_active ? "aktif" : "nonaktif"}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        onClick={() => setTemplateForm(template)}
                        className="h-9 rounded-lg border border-border px-3 text-sm font-semibold text-primary"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
                {templateQuery.isError && (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-sm text-red-700">
                      Template tidak dapat dimuat. Isi ADMIN_TOKEN jika proteksi admin aktif.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeAdminTab === "Upload Histori" && (
        <div className="mt-5 grid gap-5 xl:grid-cols-[420px_1fr]">
          <div className="rounded-lg border border-border bg-background p-4">
            <h3 className="text-base font-bold text-primary">Upload Word / Excel</h3>
            <div className="mt-4 grid gap-3">
              <select
                value={historyMode}
                onChange={(event) => setHistoryMode(event.target.value as "append" | "replace")}
                className="h-11 rounded-lg border border-border bg-surface px-3 text-sm"
              >
                <option value="append">Append histori baru</option>
                <option value="replace">Replace histori lama</option>
              </select>
              <label className="flex min-h-28 cursor-pointer items-center justify-center rounded-lg border border-dashed border-border bg-surface px-4 text-center text-sm text-textSecondary">
                <input
                  className="sr-only"
                  type="file"
                  accept=".docx,.xlsx,.xls,.csv"
                  onChange={(event) => setHistoryFile(event.target.files?.[0] ?? null)}
                />
                {historyFile ? historyFile.name : "Pilih file DOCX, XLSX, XLS, atau CSV"}
              </label>
              <button
                type="button"
                onClick={() => uploadHistoryMutation.mutate()}
                disabled={uploadHistoryMutation.isPending || !historyFile}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:opacity-70"
              >
                <UploadCloud className="h-4 w-4" />
                Upload Histori
              </button>
            </div>
          </div>

          <div className="overflow-x-auto stable-scrollbar">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-background text-left text-textSecondary">
                  <th className="px-3 py-3 font-semibold">File</th>
                  <th className="px-3 py-3 font-semibold">Tipe</th>
                  <th className="px-3 py-3 font-semibold">Mode</th>
                  <th className="px-3 py-3 font-semibold">Waktu Upload</th>
                </tr>
              </thead>
              <tbody>
                {(historyQuery.data?.uploads ?? []).map((upload) => (
                  <tr key={upload.id} className="border-b border-border/70">
                    <td className="px-3 py-3 font-semibold text-primary">{upload.file_name}</td>
                    <td className="px-3 py-3 text-textSecondary">{upload.file_type}</td>
                    <td className="px-3 py-3 text-textSecondary">{upload.upload_mode}</td>
                    <td className="px-3 py-3 text-textSecondary">{new Date(upload.created_at).toLocaleString("id-ID")}</td>
                  </tr>
                ))}
                {historyQuery.isError && (
                  <tr>
                    <td colSpan={4} className="px-3 py-8 text-center text-sm text-red-700">
                      Histori tidak dapat dimuat. Isi ADMIN_TOKEN jika proteksi admin aktif.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeAdminTab === "Monitoring Source" && (
        <div className="mt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-primary">Monitoring Source</h3>
              <p className="mt-1 text-sm text-textSecondary">Cek akses source, validasi element, dan simpan error log.</p>
            </div>
            <button
              type="button"
              onClick={() => monitoringMutation.mutate()}
              disabled={monitoringMutation.isPending}
              className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:opacity-70"
            >
              <Activity className="h-4 w-4" />
              Cek Source
            </button>
          </div>
          <div className="mt-5 overflow-x-auto stable-scrollbar">
            <table className="w-full min-w-[920px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-background text-left text-textSecondary">
                  <th className="px-3 py-3 font-semibold">Source</th>
                  <th className="px-3 py-3 font-semibold">Status</th>
                  <th className="px-3 py-3 font-semibold">HTTP</th>
                  <th className="px-3 py-3 font-semibold">Catatan</th>
                  <th className="px-3 py-3 font-semibold">Waktu Cek</th>
                </tr>
              </thead>
              <tbody>
                {(monitoringQuery.data?.logs ?? []).map((log) => (
                  <tr key={log.id} className="border-b border-border/70 align-top">
                    <td className="px-3 py-3">
                      <p className="font-semibold text-primary">{log.source_name}</p>
                      <p className="mt-1 max-w-[260px] truncate text-xs text-textSecondary">{log.source_url}</p>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClass(log.status)}`}>{log.status}</span>
                    </td>
                    <td className="px-3 py-3 text-textSecondary">{log.http_status ?? "-"}</td>
                    <td className="px-3 py-3 text-textSecondary">{log.message}</td>
                    <td className="px-3 py-3 text-textSecondary">{new Date(log.checked_at).toLocaleString("id-ID")}</td>
                  </tr>
                ))}
                {monitoringQuery.isError && (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-sm text-red-700">
                      Log monitoring tidak dapat dimuat. Isi ADMIN_TOKEN jika proteksi admin aktif.
                    </td>
                  </tr>
                )}
                {!monitoringQuery.data?.logs?.length && !monitoringQuery.isError && (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-sm text-textSecondary">
                      Belum ada log. Klik Cek Source untuk mulai monitoring.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
