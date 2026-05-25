import { contentSourceMap, portalContentTypes, sourceConfigs } from "./content-framework";
import { hasDatabaseUrl, withDatabaseClient } from "./db";
import { templateProfiles } from "./editorial-templates";
import type {
  AdminSourceRecord,
  ArticleTemplateRecord,
  HistoryUploadRecord,
  Portal,
  SourceConfig,
  SourceContentMapping,
  SourceMonitorLog
} from "./types";

type PgClient = import("pg").Client;

type AdminSourceInput = Omit<AdminSourceRecord, "id" | "created_at" | "updated_at"> & {
  id?: string;
};

type ArticleTemplateInput = Omit<ArticleTemplateRecord, "id" | "created_at" | "updated_at"> & {
  id?: string;
};

let memorySources: AdminSourceRecord[] | null = null;
let memoryTemplates: ArticleTemplateRecord[] | null = null;
let memoryHistoryUploads: HistoryUploadRecord[] = [];
let memoryMonitorLogs: SourceMonitorLog[] = [];

const sourceGroups: SourceConfig["group"][] = ["antam", "perak", "dunia", "perhiasan", "pegadaian", "digital", "emas-kecil", "manual"];

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

async function withClient<T>(callback: (client: PgClient) => Promise<T>) {
  return withDatabaseClient(async (client) => {
    await ensureAdminTables(client);
    await seedAdminDefaults(client);
    return await callback(client);
  });
}

function sourceContentMapping(sourceName: string): SourceContentMapping[] {
  const mapping: SourceContentMapping[] = [];
  for (const [portal, contentMap] of Object.entries(contentSourceMap) as [Portal, Record<string, string[]>][]) {
    for (const [jenisKonten, sourceNames] of Object.entries(contentMap)) {
      if (sourceNames.includes(sourceName)) mapping.push({ portal, jenis_konten: jenisKonten });
    }
  }
  return mapping;
}

function defaultTemplateBody(portal: Portal) {
  if (portal === "Beritasatu") {
    return "{dateline} - {jenis_konten} pada {tanggal} {gerak} berdasarkan pembaruan data terbaru dari {source}. Harga utama berada di {harga_utama} untuk {berat}.";
  }

  return "{dateline} - {jenis_konten} menjadi perhatian investor pada {tanggal}. Data terbaru dari {source} menunjukkan harga utama berada di {harga_utama} untuk {berat}, dengan konteks pasar yang perlu dicermati pelaku pasar.";
}

function defaultTemplates() {
  return (Object.entries(portalContentTypes) as [Portal, string[]][]).flatMap(([portal, contentTypes]) =>
    contentTypes.map<ArticleTemplateRecord>((jenisKonten) => {
      const profile = templateProfiles[portal];
      return {
        id: createId("tpl"),
        portal,
        jenis_konten: jenisKonten,
        headline_template: profile.headlinePatterns[0] ?? "{jenis_konten} Hari Ini {tanggal}: {gerak}",
        body_template: defaultTemplateBody(portal),
        source_mapping: contentSourceMap[portal]?.[jenisKonten] ?? [],
        example_patterns: profile.headlinePatterns,
        is_active: true,
        created_at: nowIso(),
        updated_at: nowIso()
      };
    })
  );
}

function sourceToAdminRecord(source: SourceConfig): AdminSourceRecord {
  return {
    id: createId("src"),
    ...source,
    is_active: true,
    content_mapping: sourceContentMapping(source.name),
    created_at: nowIso(),
    updated_at: nowIso()
  };
}

function ensureMemorySeeded() {
  if (!memorySources) memorySources = sourceConfigs.map(sourceToAdminRecord);
  if (!memoryTemplates) memoryTemplates = defaultTemplates();
}

function selectorConfigFromSource(source: SourceConfig) {
  return {
    selectorSummary: source.selectorSummary,
    parserType:
      source.parserType ??
      (source.name === "Logam Mulia" ? "logam-mulia" : source.name === "Raja Emas" ? "raja-emas" : "generic-table"),
    titleSelector: source.titleSelector ?? "",
    dataSelector: source.dataSelector ?? "",
    rowSelector: source.rowSelector ?? "",
    fieldMapping: source.fieldMapping ?? {},
    timestampSelector: source.timestampSelector ?? "",
    elementKeywords: source.elementKeywords,
    includeKeywords: source.includeKeywords ?? [],
    excludeKeywords: source.excludeKeywords ?? [],
    boundaryStartKeywords: source.boundaryStartKeywords ?? [],
    boundaryStopKeywords: source.boundaryStopKeywords ?? []
  };
}

function sourceRecordFromRow(row: Record<string, unknown>): AdminSourceRecord {
  const selectorConfig = (row.selector_config ?? {}) as Partial<ReturnType<typeof selectorConfigFromSource>>;
  const group = sourceGroups.includes(row.source_group as SourceConfig["group"]) ? (row.source_group as SourceConfig["group"]) : "manual";
  const contentMapping = Array.isArray(row.content_mapping) ? (row.content_mapping as SourceContentMapping[]) : [];
  const record: AdminSourceRecord = {
    id: String(row.id),
    name: String(row.source_name),
    url: String(row.source_url),
    mode: row.mode === "manual" ? "manual" : "otomatis",
    group,
    selectorSummary: String(selectorConfig.selectorSummary ?? ""),
    parserType:
      selectorConfig.parserType === "logam-mulia"
        ? "logam-mulia"
        : selectorConfig.parserType === "raja-emas"
          ? "raja-emas"
          : "generic-table",
    titleSelector: selectorConfig.titleSelector ? String(selectorConfig.titleSelector) : undefined,
    dataSelector: selectorConfig.dataSelector ? String(selectorConfig.dataSelector) : undefined,
    rowSelector: selectorConfig.rowSelector ? String(selectorConfig.rowSelector) : undefined,
    fieldMapping:
      selectorConfig.fieldMapping && typeof selectorConfig.fieldMapping === "object"
        ? (selectorConfig.fieldMapping as SourceConfig["fieldMapping"])
        : undefined,
    timestampSelector: selectorConfig.timestampSelector ? String(selectorConfig.timestampSelector) : undefined,
    elementKeywords: Array.isArray(selectorConfig.elementKeywords) ? selectorConfig.elementKeywords.map(String) : [],
    includeKeywords: Array.isArray(selectorConfig.includeKeywords) ? selectorConfig.includeKeywords.map(String) : [],
    excludeKeywords: Array.isArray(selectorConfig.excludeKeywords) ? selectorConfig.excludeKeywords.map(String) : [],
    boundaryStartKeywords: Array.isArray(selectorConfig.boundaryStartKeywords) ? selectorConfig.boundaryStartKeywords.map(String) : [],
    boundaryStopKeywords: Array.isArray(selectorConfig.boundaryStopKeywords) ? selectorConfig.boundaryStopKeywords.map(String) : [],
    priceCurrency: row.price_currency === "USD" ? "USD" : "IDR",
    operationalNote: row.operational_note ? String(row.operational_note) : undefined,
    is_active: Boolean(row.is_active),
    content_mapping: contentMapping,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? ""),
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at ?? "")
  };

  if (/^logam\s*mulia$/i.test(record.name)) {
    return {
      ...record,
      parserType: "logam-mulia",
      dataSelector: "table.table-bordered",
      rowSelector: "table.table-bordered tr",
      fieldMapping: {
        ...(record.fieldMapping ?? {}),
        weightIndex: 0,
        priceIndex: 1,
        basePriceIndex: 1,
        pricePph025Index: 2
      },
      elementKeywords: record.elementKeywords.length ? record.elementKeywords : ["Emas Batangan", "Perak Murni"],
      boundaryStartKeywords: record.boundaryStartKeywords?.length ? record.boundaryStartKeywords : ["Emas Batangan", "Perak Murni"],
      boundaryStopKeywords: record.boundaryStopKeywords?.length
        ? record.boundaryStopKeywords
        : ["Emas Batangan Gift Series", "Emas Batangan Selamat Idul Fitri", "Emas Batangan Imlek", "Emas Batangan Batik Seri III", "Perak Heritage"]
    };
  }

  return record;
}

function templateRecordFromRow(row: Record<string, unknown>): ArticleTemplateRecord {
  return {
    id: String(row.id),
    portal: row.portal === "Beritasatu" ? "Beritasatu" : "Investor Daily",
    jenis_konten: String(row.jenis_konten),
    headline_template: String(row.headline_template ?? ""),
    body_template: String(row.body_template ?? ""),
    source_mapping: Array.isArray(row.source_mapping) ? row.source_mapping.map(String) : [],
    example_patterns: Array.isArray(row.example_patterns) ? row.example_patterns.map(String) : [],
    is_active: Boolean(row.is_active),
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? ""),
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at ?? "")
  };
}

function historyRecordFromRow(row: Record<string, unknown>): HistoryUploadRecord {
  return {
    id: String(row.id),
    file_name: String(row.file_name),
    file_type: String(row.file_type),
    upload_mode: row.upload_mode === "replace" ? "replace" : "append",
    parsed_summary: row.parsed_summary,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at)
  };
}

function monitorLogFromRow(row: Record<string, unknown>): SourceMonitorLog {
  const status = ["success", "warning", "error", "manual"].includes(String(row.status)) ? (row.status as SourceMonitorLog["status"]) : "warning";
  return {
    id: String(row.id),
    source_name: String(row.source_name),
    source_url: String(row.source_url),
    status,
    http_status: typeof row.http_status === "number" ? row.http_status : row.http_status ? Number(row.http_status) : null,
    message: String(row.message ?? ""),
    checked_at: row.checked_at instanceof Date ? row.checked_at.toISOString() : String(row.checked_at ?? "")
  };
}

async function ensureAdminTables(client: PgClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS source_mapping_master (
      id TEXT PRIMARY KEY,
      source_name TEXT UNIQUE NOT NULL,
      source_url TEXT NOT NULL,
      selector_config JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await client.query("ALTER TABLE source_mapping_master ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'otomatis';");
  await client.query("ALTER TABLE source_mapping_master ADD COLUMN IF NOT EXISTS source_group TEXT NOT NULL DEFAULT 'manual';");
  await client.query("ALTER TABLE source_mapping_master ADD COLUMN IF NOT EXISTS price_currency TEXT NOT NULL DEFAULT 'IDR';");
  await client.query("ALTER TABLE source_mapping_master ADD COLUMN IF NOT EXISTS operational_note TEXT;");
  await client.query("ALTER TABLE source_mapping_master ADD COLUMN IF NOT EXISTS content_mapping JSONB NOT NULL DEFAULT '[]'::jsonb;");
  await client.query("ALTER TABLE source_mapping_master ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;");

  await client.query(`
    CREATE TABLE IF NOT EXISTS article_templates (
      id TEXT PRIMARY KEY,
      portal TEXT NOT NULL,
      jenis_konten TEXT NOT NULL,
      headline_template TEXT NOT NULL,
      body_template TEXT NOT NULL,
      source_mapping JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await client.query("ALTER TABLE article_templates ADD COLUMN IF NOT EXISTS example_patterns JSONB NOT NULL DEFAULT '[]'::jsonb;");
  await client.query("ALTER TABLE article_templates ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;");

  await client.query(`
    CREATE TABLE IF NOT EXISTS history_uploads (
      id TEXT PRIMARY KEY,
      file_name TEXT NOT NULL,
      file_type TEXT NOT NULL,
      upload_mode TEXT NOT NULL,
      parsed_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS source_monitor_logs (
      id TEXT PRIMARY KEY,
      source_name TEXT NOT NULL,
      source_url TEXT NOT NULL,
      status TEXT NOT NULL,
      http_status INTEGER,
      message TEXT NOT NULL,
      checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function seedAdminDefaults(client: PgClient) {
  for (const source of sourceConfigs) {
    await client.query(
      `INSERT INTO source_mapping_master (
        id, source_name, source_url, selector_config, mode, source_group, price_currency,
        operational_note, content_mapping, is_active, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE,NOW(),NOW())
      ON CONFLICT (source_name) DO NOTHING`,
      [
        createId("src"),
        source.name,
        source.url,
        JSON.stringify(selectorConfigFromSource(source)),
        source.mode,
        source.group,
        source.priceCurrency,
        source.operationalNote ?? null,
        JSON.stringify(sourceContentMapping(source.name))
      ]
    );
  }

  for (const template of defaultTemplates()) {
    const exists = await client.query(
      "SELECT id FROM article_templates WHERE portal = $1 AND jenis_konten = $2 LIMIT 1",
      [template.portal, template.jenis_konten]
    );
    if (exists.rowCount) continue;
    await client.query(
      `INSERT INTO article_templates (
        id, portal, jenis_konten, headline_template, body_template, source_mapping,
        example_patterns, is_active, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE,NOW(),NOW())`,
      [
        template.id,
        template.portal,
        template.jenis_konten,
        template.headline_template,
        template.body_template,
        JSON.stringify(template.source_mapping),
        JSON.stringify(template.example_patterns)
      ]
    );
  }
}

export function adminSourceToConfig(source: AdminSourceRecord): SourceConfig {
  return {
    name: source.name,
    url: source.url,
    mode: source.mode,
    group: source.group,
    selectorSummary: source.selectorSummary,
    parserType: source.parserType,
    titleSelector: source.titleSelector,
    dataSelector: source.dataSelector,
    rowSelector: source.rowSelector,
    fieldMapping: source.fieldMapping,
    timestampSelector: source.timestampSelector,
    elementKeywords: source.elementKeywords,
    includeKeywords: source.includeKeywords,
    excludeKeywords: source.excludeKeywords,
    boundaryStartKeywords: source.boundaryStartKeywords,
    boundaryStopKeywords: source.boundaryStopKeywords,
    priceCurrency: source.priceCurrency,
    operationalNote: source.operationalNote
  };
}

export async function getAdminSources() {
  if (hasDatabaseUrl()) {
    return withClient(async (client) => {
      const result = await client.query("SELECT * FROM source_mapping_master ORDER BY source_name ASC");
      return result.rows.map(sourceRecordFromRow);
    });
  }

  ensureMemorySeeded();
  return [...(memorySources ?? [])].sort((a, b) => a.name.localeCompare(b.name));
}

export async function upsertAdminSource(input: AdminSourceInput) {
  const next: AdminSourceRecord = {
    id: input.id || createId("src"),
    ...input,
    selectorSummary: input.selectorSummary || input.dataSelector || input.titleSelector || "Belum ada ringkasan selector.",
    elementKeywords: input.elementKeywords ?? [],
    content_mapping: input.content_mapping ?? [],
    created_at: nowIso(),
    updated_at: nowIso()
  };

  if (hasDatabaseUrl()) {
    return withClient(async (client) => {
      await client.query(
        `INSERT INTO source_mapping_master (
          id, source_name, source_url, selector_config, mode, source_group, price_currency,
          operational_note, content_mapping, is_active, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())
        ON CONFLICT (source_name) DO UPDATE SET
          source_url = EXCLUDED.source_url,
          selector_config = EXCLUDED.selector_config,
          mode = EXCLUDED.mode,
          source_group = EXCLUDED.source_group,
          price_currency = EXCLUDED.price_currency,
          operational_note = EXCLUDED.operational_note,
          content_mapping = EXCLUDED.content_mapping,
          is_active = EXCLUDED.is_active,
          updated_at = NOW()`,
        [
          next.id,
          next.name,
          next.url,
          JSON.stringify(selectorConfigFromSource(next)),
          next.mode,
          next.group,
          next.priceCurrency,
          next.operationalNote ?? null,
          JSON.stringify(next.content_mapping),
          next.is_active
        ]
      );
      const result = await client.query("SELECT * FROM source_mapping_master WHERE source_name = $1 LIMIT 1", [next.name]);
      return sourceRecordFromRow(result.rows[0]);
    });
  }

  ensureMemorySeeded();
  const current = memorySources ?? [];
  const existingIndex = current.findIndex((source) => source.name === next.name);
  const merged = existingIndex >= 0 ? { ...current[existingIndex], ...next, updated_at: nowIso() } : next;
  memorySources = existingIndex >= 0 ? current.map((source, index) => (index === existingIndex ? merged : source)) : [...current, merged];
  return merged;
}

export async function getRuntimeSourcesForContent(portal: Portal, jenisKonten: string) {
  const adminSources = await getAdminSources();
  const exactSources = adminSources
    .filter((source) => source.is_active)
    .filter((source) => source.content_mapping.some((mapping) => mapping.portal === portal && mapping.jenis_konten === jenisKonten))
    .map(adminSourceToConfig);

  if (exactSources.length > 0) return exactSources;

  return adminSources
    .filter((source) => source.is_active)
    .filter((source) => source.content_mapping.length === 0 || source.content_mapping.some((mapping) => mapping.portal === portal))
    .map(adminSourceToConfig);
}

export async function getRuntimeSourcesForPortal(portal: Portal) {
  const adminSources = await getAdminSources();
  return adminSources
    .filter((source) => source.is_active)
    .filter((source) => source.content_mapping.length === 0 || source.content_mapping.some((mapping) => mapping.portal === portal))
    .map(adminSourceToConfig);
}

export async function getAdminTemplates() {
  if (hasDatabaseUrl()) {
    return withClient(async (client) => {
      const result = await client.query("SELECT * FROM article_templates ORDER BY portal ASC, jenis_konten ASC, updated_at DESC");
      return result.rows.map(templateRecordFromRow);
    });
  }

  ensureMemorySeeded();
  return [...(memoryTemplates ?? [])].sort((a, b) => `${a.portal}${a.jenis_konten}`.localeCompare(`${b.portal}${b.jenis_konten}`));
}

export async function upsertArticleTemplate(input: ArticleTemplateInput) {
  const next: ArticleTemplateRecord = {
    id: input.id || createId("tpl"),
    ...input,
    source_mapping: input.source_mapping ?? [],
    example_patterns: input.example_patterns ?? [],
    created_at: nowIso(),
    updated_at: nowIso()
  };

  if (hasDatabaseUrl()) {
    return withClient(async (client) => {
      await client.query(
        `INSERT INTO article_templates (
          id, portal, jenis_konten, headline_template, body_template, source_mapping,
          example_patterns, is_active, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET
          portal = EXCLUDED.portal,
          jenis_konten = EXCLUDED.jenis_konten,
          headline_template = EXCLUDED.headline_template,
          body_template = EXCLUDED.body_template,
          source_mapping = EXCLUDED.source_mapping,
          example_patterns = EXCLUDED.example_patterns,
          is_active = EXCLUDED.is_active,
          updated_at = NOW()`,
        [
          next.id,
          next.portal,
          next.jenis_konten,
          next.headline_template,
          next.body_template,
          JSON.stringify(next.source_mapping),
          JSON.stringify(next.example_patterns),
          next.is_active
        ]
      );
      const result = await client.query("SELECT * FROM article_templates WHERE id = $1 LIMIT 1", [next.id]);
      return templateRecordFromRow(result.rows[0]);
    });
  }

  ensureMemorySeeded();
  const current = memoryTemplates ?? [];
  const existingIndex = current.findIndex((template) => template.id === next.id);
  const merged = existingIndex >= 0 ? { ...current[existingIndex], ...next, updated_at: nowIso() } : next;
  memoryTemplates = existingIndex >= 0 ? current.map((template, index) => (index === existingIndex ? merged : template)) : [...current, merged];
  return merged;
}

export async function getRuntimeArticleTemplate(portal: Portal, jenisKonten: string) {
  const templates = await getAdminTemplates();
  return (
    templates.find((template) => template.is_active && template.portal === portal && template.jenis_konten === jenisKonten) ??
    templates.find((template) => template.is_active && template.portal === portal) ??
    null
  );
}

export async function saveHistoryUpload(fileName: string, fileType: string, uploadMode: "append" | "replace", parsedSummary: unknown) {
  const record: HistoryUploadRecord = {
    id: createId("hist"),
    file_name: fileName,
    file_type: fileType,
    upload_mode: uploadMode,
    parsed_summary: parsedSummary,
    created_at: nowIso()
  };

  if (hasDatabaseUrl()) {
    return withClient(async (client) => {
      if (uploadMode === "replace") await client.query("DELETE FROM history_uploads");
      await client.query(
        "INSERT INTO history_uploads (id, file_name, file_type, upload_mode, parsed_summary, created_at) VALUES ($1,$2,$3,$4,$5,NOW())",
        [record.id, record.file_name, record.file_type, record.upload_mode, JSON.stringify(record.parsed_summary)]
      );
      const result = await client.query("SELECT * FROM history_uploads WHERE id = $1 LIMIT 1", [record.id]);
      return historyRecordFromRow(result.rows[0]);
    });
  }

  if (uploadMode === "replace") memoryHistoryUploads = [];
  memoryHistoryUploads = [record, ...memoryHistoryUploads];
  return record;
}

export async function getHistoryUploads() {
  if (hasDatabaseUrl()) {
    return withClient(async (client) => {
      const result = await client.query("SELECT * FROM history_uploads ORDER BY created_at DESC LIMIT 100");
      return result.rows.map(historyRecordFromRow);
    });
  }

  return [...memoryHistoryUploads];
}

export async function saveMonitorLogs(logs: Omit<SourceMonitorLog, "id" | "checked_at">[]) {
  const records = logs.map<SourceMonitorLog>((log) => ({
    id: createId("mon"),
    checked_at: nowIso(),
    ...log
  }));

  if (hasDatabaseUrl()) {
    return withClient(async (client) => {
      for (const record of records) {
        await client.query(
          `INSERT INTO source_monitor_logs (id, source_name, source_url, status, http_status, message, checked_at)
          VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
          [record.id, record.source_name, record.source_url, record.status, record.http_status, record.message]
        );
      }
      const result = await client.query("SELECT * FROM source_monitor_logs ORDER BY checked_at DESC LIMIT 100");
      return result.rows.map(monitorLogFromRow);
    });
  }

  memoryMonitorLogs = [...records, ...memoryMonitorLogs].slice(0, 100);
  return [...memoryMonitorLogs];
}

export async function getMonitorLogs() {
  if (hasDatabaseUrl()) {
    return withClient(async (client) => {
      const result = await client.query("SELECT * FROM source_monitor_logs ORDER BY checked_at DESC LIMIT 100");
      return result.rows.map(monitorLogFromRow);
    });
  }

  return [...memoryMonitorLogs];
}
