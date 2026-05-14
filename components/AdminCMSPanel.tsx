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
  GoldPriceRow,
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

type SourcePreviewResponse = {
  ok: boolean;
  preview: {
    ok: boolean;
    selector: string;
    previewedAt: string;
    rowsFound: number;
    validRows: number;
    rows: GoldPriceRow[];
    debug?: {
      parser?: string;
      sectionsFound?: string[];
      ignoredSections?: string[];
      validRows?: number;
      skippedRows?: number;
      skippedSamples?: Array<{ section: string | null; reason: string; sample: string }>;
      stoppedAtSection?: string | null;
    };
    message: string;
  };
};

type SourceDocumentValidationResponse = {
  ok: boolean;
  status: "VALID" | "INVALID";
  notification?: DashboardNotification;
  extraction: {
    sourceName: string;
    fileName: string;
    url: string;
    rowSelector: string;
    parserType: "logam-mulia";
    fieldMapping: {
      weightIndex?: number;
      priceIndex?: number;
      basePriceIndex?: number;
      pricePph025Index?: number;
    };
    requiredFields: {
      fields: string[];
      labels: Record<string, string>;
    };
    sections: string[];
    jenisKonten: string;
    rawTextSample: string;
    source: Omit<AdminSourceRecord, "id" | "is_active" | "content_mapping">;
    extractionNotes: string[];
  };
  validation: {
    ok: boolean;
    status: "VALID" | "INVALID";
    selector: string;
    checkedAt: string;
    checks: {
      urlAccessible: boolean;
      selectorFound: boolean;
      rowFound: boolean;
      fieldMappingValid: boolean;
      dataParsed: boolean;
    };
    reasons: string[];
    recommendations: string[];
    debug: {
      selector: string;
      elementCount: number;
      rowCount: number;
      validDataCount: number;
      sampleHtml: string;
      sampleParsedRow: GoldPriceRow | null;
      sectionsFound?: string[];
      ignoredSections?: string[];
      skippedRows?: number;
      skippedSamples?: Array<{ section: string | null; reason: string; sample: string }>;
      stoppedAtSection?: string | null;
      checkedAt: string;
    };
    rows: GoldPriceRow[];
  };
};

const adminTabs: AdminTab[] = ["Pengaturan Source", "Template Artikel", "Upload Histori", "Monitoring Source"];

const emptySource: AdminSourceRecord = {
  id: "",
  name: "",
  url: "",
  mode: "otomatis",
  group: "manual",
  selectorSummary: "",
  parserType: "generic-table",
  titleSelector: "",
  dataSelector: "",
  rowSelector: "",
  fieldMapping: { weightIndex: 0, priceIndex: 1 },
  timestampSelector: "",
  elementKeywords: [],
  includeKeywords: [],
  excludeKeywords: [],
  boundaryStartKeywords: [],
  boundaryStopKeywords: [],
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

function sourcePreviewSignature(source: AdminSourceRecord) {
  return JSON.stringify({
    name: source.name,
    url: source.url,
    mode: source.mode,
    group: source.group,
    parserType: source.parserType,
    dataSelector: source.dataSelector,
    rowSelector: source.rowSelector,
    fieldMapping: source.fieldMapping,
    elementKeywords: source.elementKeywords,
    includeKeywords: source.includeKeywords,
    excludeKeywords: source.excludeKeywords,
    boundaryStartKeywords: source.boundaryStartKeywords,
    boundaryStopKeywords: source.boundaryStopKeywords,
    priceCurrency: source.priceCurrency
  });
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

function formatAuditPrice(value?: number | null) {
  return typeof value === "number" ? value.toLocaleString("id-ID") : "-";
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
  const [sourcePreview, setSourcePreview] = useState<SourcePreviewResponse["preview"] | null>(null);
  const [sourcePreviewKey, setSourcePreviewKey] = useState("");
  const [sourceDocumentFile, setSourceDocumentFile] = useState<File | null>(null);
  const [sourceDocumentAudit, setSourceDocumentAudit] = useState<SourceDocumentValidationResponse | null>(null);

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

  function applySourceDocumentAudit(audit: SourceDocumentValidationResponse) {
    const mappingsFromAudit: SourceContentMapping[] =
      audit.extraction.jenisKonten === "Harga Perak"
        ? [{ portal: "Beritasatu", jenis_konten: "Harga Perak" }]
        : [
            { portal: "Beritasatu", jenis_konten: "Harga Emas" },
            { portal: "Investor Daily", jenis_konten: "Harga Emas ANTAM" }
          ];
    const nextSource: AdminSourceRecord = {
      ...emptySource,
      ...audit.extraction.source,
      id: "",
      is_active: true,
      content_mapping: mappingsFromAudit
    };
    setSourceForm(nextSource);
    setSourcePreview({
      ok: audit.validation.ok,
      selector: audit.validation.selector,
      previewedAt: audit.validation.checkedAt,
      rowsFound: audit.validation.debug.rowCount,
      validRows: audit.validation.debug.validDataCount,
      rows: audit.validation.rows,
      message: audit.validation.ok
        ? `Validasi dokumen menemukan ${audit.validation.debug.validDataCount} data valid.`
        : audit.validation.reasons[0] ?? "Validasi dokumen belum valid."
    });
    setSourcePreviewKey(sourcePreviewSignature(nextSource));
  }

  const saveSourceMutation = useMutation({
    mutationFn: async () => {
      if (sourceForm.mode === "otomatis" && (!sourcePreview?.ok || sourcePreview.validRows === 0 || sourcePreviewKey !== sourcePreviewSignature(sourceForm))) {
        throw new Error("Klik Preview Scrape terlebih dahulu dan pastikan data valid sebelum menyimpan source.");
      }
      const body = {
        ...sourceForm,
        id: sourceForm.id || undefined,
        name: sourceForm.name.trim(),
        url: sourceForm.url.trim(),
        selectorSummary: sourceForm.selectorSummary.trim(),
        titleSelector: sourceForm.titleSelector?.trim() || undefined,
        dataSelector: sourceForm.dataSelector?.trim() || undefined,
        rowSelector: sourceForm.rowSelector?.trim() || undefined,
        parserType: sourceForm.parserType ?? "generic-table",
        fieldMapping: sourceForm.fieldMapping,
        timestampSelector: sourceForm.timestampSelector?.trim() || undefined,
        operationalNote: sourceForm.operationalNote?.trim() || undefined,
        elementKeywords: sourceForm.elementKeywords,
        includeKeywords: sourceForm.includeKeywords ?? [],
        excludeKeywords: sourceForm.excludeKeywords ?? [],
        boundaryStartKeywords: sourceForm.boundaryStartKeywords ?? [],
        boundaryStopKeywords: sourceForm.boundaryStopKeywords ?? []
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

  const previewSourceMutation = useMutation({
    mutationFn: async () =>
      readResponse<SourcePreviewResponse>(
        await fetch("/api/admin/source-preview", {
          method: "POST",
          headers: adminHeaders(adminToken),
          body: JSON.stringify({
            ...sourceForm,
            parserType: sourceForm.parserType ?? "generic-table",
            fieldMapping: sourceForm.fieldMapping,
            jenisKonten: sourceForm.content_mapping[0]?.jenis_konten
          })
        })
      ),
    onSuccess: (data) => {
      setSourcePreview(data.preview);
      setSourcePreviewKey(sourcePreviewSignature(sourceForm));
      pushNotifications([
        {
          id: crypto.randomUUID(),
          kind: data.preview.ok ? "success" : "warning",
          title: "Preview scrape selesai",
          message: data.preview.message
        }
      ]);
    },
    onError: (error) => {
      const payload = error as { message?: string };
      pushNotifications([
        {
          id: crypto.randomUUID(),
          kind: "error",
          title: "Preview scrape gagal",
          message: payload.message ?? "Periksa ADMIN_TOKEN, URL, atau selector source."
        }
      ]);
    }
  });

  const sourceDocumentMutation = useMutation({
    mutationFn: async () => {
      if (!sourceDocumentFile) throw new Error("Pilih file DOCX source Logam Mulia terlebih dahulu.");
      const form = new FormData();
      form.set("file", sourceDocumentFile);
      return readResponse<SourceDocumentValidationResponse>(
        await fetch("/api/admin/source-document-validation", {
          method: "POST",
          headers: adminHeaders(adminToken, false),
          body: form
        })
      );
    },
    onSuccess: (data) => {
      setSourceDocumentAudit(data);
      pushApiNotification(data, {
        id: crypto.randomUUID(),
        kind: data.ok ? "success" : "warning",
        title: data.ok ? "Dokumen source valid" : "Dokumen source perlu dicek",
        message: data.ok ? "Validasi source Logam Mulia berhasil." : data.validation.reasons[0] ?? "Validasi source belum berhasil."
      });
    },
    onError: (error) => {
      const payload = error as { message?: string };
      pushNotifications([
        {
          id: crypto.randomUUID(),
          kind: "error",
          title: "Validasi dokumen gagal",
          message: payload.message ?? "Dokumen source tidak dapat diproses."
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
          <div className="rounded-lg border border-border bg-background p-4 xl:col-span-2">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-bold text-primary">Audit Dokumen Source Logam Mulia</h3>
                <p className="mt-1 text-sm text-textSecondary">
                  Upload dokumen source untuk mengekstrak URL, selector, section, dan mapping kolom. Sistem akan mengetesnya ke website real sebelum config dipakai.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <label className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface px-4 text-sm font-semibold text-textSecondary">
                  <UploadCloud className="h-4 w-4" />
                  <input
                    className="sr-only"
                    type="file"
                    accept=".docx"
                    onChange={(event) => {
                      setSourceDocumentFile(event.target.files?.[0] ?? null);
                      setSourceDocumentAudit(null);
                    }}
                  />
                  {sourceDocumentFile ? sourceDocumentFile.name : "Pilih DOCX Source"}
                </label>
                <button
                  type="button"
                  onClick={() => sourceDocumentMutation.mutate()}
                  disabled={sourceDocumentMutation.isPending || !sourceDocumentFile}
                  className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:opacity-70"
                >
                  <Activity className="h-4 w-4" />
                  Validasi Dokumen Source
                </button>
              </div>
            </div>

            {sourceDocumentAudit && (
              <div className="mt-4 grid gap-4 xl:grid-cols-[360px_1fr]">
                <div className="rounded-lg border border-border bg-surface p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-bold text-textPrimary">Status Validasi</p>
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClass(sourceDocumentAudit.ok ? "success" : "error")}`}>
                      {sourceDocumentAudit.status}
                    </span>
                  </div>
                  <dl className="mt-3 grid gap-2 text-xs text-textSecondary">
                    <div>
                      <dt className="font-semibold text-textPrimary">URL</dt>
                      <dd className="break-all">{sourceDocumentAudit.extraction.url || "Tidak ditemukan"}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-textPrimary">Selector dipakai</dt>
                      <dd>{sourceDocumentAudit.validation.selector || "-"}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-textPrimary">Section</dt>
                      <dd>{sourceDocumentAudit.extraction.sections.join(", ")}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-textPrimary">Field mapping</dt>
                      <dd>td[0] weight, td[1] base_price, td[2] price_pph_025</dd>
                    </div>
                  </dl>
                  <div className="mt-3 grid gap-1 text-xs">
                    {[
                      ["URL dapat diakses", sourceDocumentAudit.validation.checks.urlAccessible],
                      ["Selector ditemukan", sourceDocumentAudit.validation.checks.selectorFound],
                      ["Row ditemukan", sourceDocumentAudit.validation.checks.rowFound],
                      ["Field mapping sesuai", sourceDocumentAudit.validation.checks.fieldMappingValid],
                      ["Data berhasil diparse", sourceDocumentAudit.validation.checks.dataParsed]
                    ].map(([label, valid]) => (
                      <div key={String(label)} className="flex items-center justify-between gap-3 rounded-md bg-background px-2 py-1.5">
                        <span className="text-textSecondary">{label}</span>
                        <span className={`font-semibold ${valid ? "text-emerald-700" : "text-red-700"}`}>{valid ? "Ya" : "Tidak"}</span>
                      </div>
                    ))}
                  </div>
                  {!!sourceDocumentAudit.validation.reasons.length && (
                    <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                      <p className="font-bold">Alasan invalid</p>
                      <ul className="mt-1 list-disc space-y-1 pl-4">
                        {sourceDocumentAudit.validation.reasons.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {!!sourceDocumentAudit.validation.recommendations.length && (
                    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                      <p className="font-bold">Rekomendasi selector</p>
                      <ul className="mt-1 list-disc space-y-1 pl-4">
                        {sourceDocumentAudit.validation.recommendations.map((recommendation) => (
                          <li key={recommendation}>{recommendation}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => applySourceDocumentAudit(sourceDocumentAudit)}
                    className="mt-3 inline-flex h-10 w-full items-center justify-center rounded-lg border border-primary text-sm font-semibold text-primary"
                  >
                    Gunakan Config Ini di Form Source
                  </button>
                </div>

                <div className="grid gap-4">
                  <div className="rounded-lg border border-border bg-surface p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-bold text-textPrimary">Preview Hasil Scrape</p>
                      <p className="text-xs text-textSecondary">
                        Row ditemukan: {sourceDocumentAudit.validation.debug.rowCount} | Data valid: {sourceDocumentAudit.validation.debug.validDataCount}
                      </p>
                    </div>
                    <div className="mt-3 max-h-64 overflow-auto rounded-lg border border-border">
                      <table className="w-full min-w-[620px] border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-border bg-background text-left text-textSecondary">
                            <th className="px-2 py-2">Berat</th>
                            <th className="px-2 py-2 text-right">Harga Dasar</th>
                            <th className="px-2 py-2 text-right">Harga + Pajak PPh 0.25%</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sourceDocumentAudit.validation.rows.map((row) => (
                            <tr key={row.id} className="border-b border-border/60">
                              <td className="px-2 py-2">{row.weight ?? row.berat}</td>
                              <td className="px-2 py-2 text-right font-semibold">{formatAuditPrice(row.base_price)}</td>
                              <td className="px-2 py-2 text-right font-semibold">{formatAuditPrice(row.price_pph_025)}</td>
                            </tr>
                          ))}
                          {!sourceDocumentAudit.validation.rows.length && (
                            <tr>
                              <td colSpan={3} className="px-2 py-5 text-center text-textSecondary">
                                Belum ada data valid dari hasil audit dokumen.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="grid gap-3 lg:grid-cols-2">
                    <div className="rounded-lg border border-border bg-surface p-3">
                      <p className="text-sm font-bold text-textPrimary">Debug Info</p>
                      <dl className="mt-2 grid gap-1 text-xs text-textSecondary">
                        <div className="flex justify-between gap-3">
                          <dt>Element ditemukan</dt>
                          <dd className="font-semibold text-textPrimary">{sourceDocumentAudit.validation.debug.elementCount}</dd>
                        </div>
                        <div className="flex justify-between gap-3">
                          <dt>Section ditemukan</dt>
                          <dd className="text-right font-semibold text-textPrimary">{sourceDocumentAudit.validation.debug.sectionsFound?.join(", ") || "-"}</dd>
                        </div>
                        <div className="flex justify-between gap-3">
                          <dt>Section diabaikan</dt>
                          <dd className="text-right font-semibold text-textPrimary">{sourceDocumentAudit.validation.debug.ignoredSections?.join(", ") || "-"}</dd>
                        </div>
                        <div className="flex justify-between gap-3">
                          <dt>Row ditemukan</dt>
                          <dd className="font-semibold text-textPrimary">{sourceDocumentAudit.validation.debug.rowCount}</dd>
                        </div>
                        <div className="flex justify-between gap-3">
                          <dt>Row di-skip</dt>
                          <dd className="font-semibold text-textPrimary">{sourceDocumentAudit.validation.debug.skippedRows ?? 0}</dd>
                        </div>
                        <div className="flex justify-between gap-3">
                          <dt>Sample parsed row</dt>
                          <dd className="text-right font-semibold text-textPrimary">
                            {sourceDocumentAudit.validation.debug.sampleParsedRow
                              ? `${sourceDocumentAudit.validation.debug.sampleParsedRow.weight ?? sourceDocumentAudit.validation.debug.sampleParsedRow.berat} / ${formatAuditPrice(sourceDocumentAudit.validation.debug.sampleParsedRow.base_price)}`
                              : "-"}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-3">
                          <dt>Waktu validasi</dt>
                          <dd className="text-right font-semibold text-textPrimary">
                            {new Date(sourceDocumentAudit.validation.debug.checkedAt).toLocaleString("id-ID")}
                          </dd>
                        </div>
                      </dl>
                    </div>
                    <div className="rounded-lg border border-border bg-surface p-3">
                      <p className="text-sm font-bold text-textPrimary">Sample HTML</p>
                      <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-background p-2 text-[11px] leading-relaxed text-textSecondary">
                        {sourceDocumentAudit.validation.debug.sampleHtml || "Tidak ada sample HTML."}
                      </pre>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="rounded-lg border border-border bg-background p-4">
              <div className="flex items-center justify-between gap-3">
              <h3 className="text-base font-bold text-primary">Form Source</h3>
              <button
                type="button"
                onClick={() => {
                  setSourceForm(emptySource);
                  setSourcePreview(null);
                  setSourcePreviewKey("");
                }}
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
              <select
                value={sourceForm.parserType ?? "generic-table"}
                onChange={(event) => setSourceForm({ ...sourceForm, parserType: event.target.value as AdminSourceRecord["parserType"] })}
                className="h-11 rounded-lg border border-border bg-surface px-3 text-sm"
              >
                <option value="generic-table">generic-table</option>
                <option value="logam-mulia">logam-mulia</option>
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
                value={sourceForm.rowSelector ?? ""}
                onChange={(event) => setSourceForm({ ...sourceForm, rowSelector: event.target.value })}
                className="h-11 rounded-lg border border-border bg-surface px-3 text-sm"
                placeholder="Row selector, contoh: table.table-bordered tr"
              />
              <div className="rounded-lg border border-border bg-surface p-3">
                <p className="text-sm font-bold text-textPrimary">Field Mapping Kolom</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-4">
                  {[
                    ["weightIndex", "Berat"],
                    ["priceIndex", "Harga Utama"],
                    ["basePriceIndex", "Harga Dasar"],
                    ["pricePph025Index", "Harga + PPh"]
                  ].map(([key, label]) => (
                    <label key={key} className="grid gap-1 text-xs font-semibold text-textSecondary">
                      {label}
                      <input
                        type="number"
                        min={0}
                        value={sourceForm.fieldMapping?.[key as keyof NonNullable<AdminSourceRecord["fieldMapping"]>] ?? ""}
                        onChange={(event) => {
                          const value = event.target.value === "" ? undefined : Number(event.target.value);
                          setSourceForm({
                            ...sourceForm,
                            fieldMapping: {
                              ...(sourceForm.fieldMapping ?? {}),
                              [key]: value
                            }
                          });
                        }}
                        className="h-10 rounded-lg border border-border bg-background px-2 text-sm"
                      />
                    </label>
                  ))}
                </div>
              </div>
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
                value={(sourceForm.includeKeywords ?? []).join("\n")}
                onChange={(event) => setSourceForm({ ...sourceForm, includeKeywords: splitInput(event.target.value) })}
                className="min-h-20 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                placeholder="Include keyword row, satu per baris"
              />
              <textarea
                value={(sourceForm.excludeKeywords ?? []).join("\n")}
                onChange={(event) => setSourceForm({ ...sourceForm, excludeKeywords: splitInput(event.target.value) })}
                className="min-h-20 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                placeholder="Exclude keyword row, satu per baris"
              />
              <textarea
                value={(sourceForm.boundaryStartKeywords ?? []).join("\n")}
                onChange={(event) => setSourceForm({ ...sourceForm, boundaryStartKeywords: splitInput(event.target.value) })}
                className="min-h-20 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                placeholder="Boundary start, contoh: Emas Batangan"
              />
              <textarea
                value={(sourceForm.boundaryStopKeywords ?? []).join("\n")}
                onChange={(event) => setSourceForm({ ...sourceForm, boundaryStopKeywords: splitInput(event.target.value) })}
                className="min-h-20 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                placeholder="Boundary stop, contoh: Gift Series, Perak"
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
                onClick={() => previewSourceMutation.mutate()}
                disabled={previewSourceMutation.isPending || !sourceForm.url || !sourceForm.name}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-primary bg-surface px-4 text-sm font-semibold text-primary disabled:opacity-70"
              >
                <Activity className="h-4 w-4" />
                Preview Hasil Scrape
              </button>
              {sourcePreview && (
                <div className="rounded-lg border border-border bg-surface p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-bold text-textPrimary">Preview Hasil Scrape</p>
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClass(sourcePreview.ok ? "success" : "warning")}`}>
                      {sourcePreview.validRows} data valid
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-textSecondary">Selector: {sourcePreview.selector || "-"}</p>
                  <p className="mt-1 text-xs text-textSecondary">Row ditemukan: {sourcePreview.rowsFound} | Preview: {new Date(sourcePreview.previewedAt).toLocaleString("id-ID")}</p>
                  {sourcePreview.debug && (
                    <div className="mt-3 grid gap-2 rounded-lg border border-border bg-background p-3 text-xs text-textSecondary">
                      <p className="font-bold text-textPrimary">Debug Logam Mulia</p>
                      <p>Section ditemukan: {sourcePreview.debug.sectionsFound?.join(", ") || "-"}</p>
                      <p>Section diabaikan: {sourcePreview.debug.ignoredSections?.join(", ") || "-"}</p>
                      <p>Row valid: {sourcePreview.debug.validRows ?? sourcePreview.validRows} | Row di-skip: {sourcePreview.debug.skippedRows ?? 0}</p>
                      <p>Stop di section: {sourcePreview.debug.stoppedAtSection ?? "-"}</p>
                      {!!sourcePreview.debug.skippedSamples?.length && (
                        <div className="max-h-28 overflow-auto rounded-md bg-surface p-2">
                          {sourcePreview.debug.skippedSamples.slice(0, 4).map((item, index) => (
                            <p key={`${item.reason}-${index}`}>{item.reason}: {item.sample || "-"}</p>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <div className="mt-3 max-h-56 overflow-auto rounded-lg border border-border">
                    <table className="w-full min-w-[720px] border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-border bg-background text-left text-textSecondary">
                          <th className="px-2 py-2">Kategori</th>
                          <th className="px-2 py-2">Berat</th>
                          <th className="px-2 py-2 text-right">Harga Dasar</th>
                          <th className="px-2 py-2 text-right">Harga + Pajak PPh 0.25%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sourcePreview.rows.map((row) => (
                          <tr key={row.id} className="border-b border-border/60">
                            <td className="px-2 py-2">{row.category ?? "-"}</td>
                            <td className="px-2 py-2">{row.berat}</td>
                            <td className="px-2 py-2 text-right font-semibold">{row.base_price?.toLocaleString("id-ID") ?? row.harga ?? "-"}</td>
                            <td className="px-2 py-2 text-right font-semibold">{row.price_pph_025?.toLocaleString("id-ID") ?? "-"}</td>
                          </tr>
                        ))}
                        {!sourcePreview.rows.length && (
                          <tr>
                            <td colSpan={4} className="px-2 py-5 text-center text-textSecondary">
                              Tidak ada row valid. Periksa row selector atau boundary keyword.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
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
                    <td className="px-3 py-3 text-textSecondary">
                      <p>{source.selectorSummary}</p>
                      <p className="mt-1 text-xs">Row: {source.rowSelector ?? source.dataSelector ?? "-"}</p>
                    </td>
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        onClick={() => {
                          setSourceForm(source);
                          setSourcePreview(null);
                          setSourcePreviewKey("");
                        }}
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
              <textarea
                value={templateForm.headline_template}
                onChange={(event) => setTemplateForm({ ...templateForm, headline_template: event.target.value })}
                className="min-h-24 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                placeholder="Headline template. Bisa multi-line untuk beberapa opsi judul."
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
