export type Portal = "Beritasatu" | "Investor Daily";

export type NotificationKind = "success" | "warning" | "error" | "info";

export type SourceRunStatus = "success" | "warning" | "error" | "manual";

export type SourceName = string;

export interface DashboardNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  message: string;
  createdAt?: number;
}

export interface SourceConfig {
  name: SourceName;
  url: string;
  mode: "otomatis" | "manual";
  group:
    | "antam"
    | "perak"
    | "dunia"
    | "perhiasan"
    | "pegadaian"
    | "digital"
    | "emas-kecil"
    | "manual";
  selectorSummary: string;
  titleSelector?: string;
  dataSelector?: string;
  timestampSelector?: string;
  elementKeywords: string[];
  priceCurrency: "IDR" | "USD";
  operationalNote?: string;
}

export interface SourceContentMapping {
  portal: Portal;
  jenis_konten: string;
}

export interface AdminSourceRecord extends SourceConfig {
  id: string;
  is_active: boolean;
  content_mapping: SourceContentMapping[];
  created_at?: string;
  updated_at?: string;
}

export interface ArticleTemplateRecord {
  id: string;
  portal: Portal;
  jenis_konten: string;
  headline_template: string;
  body_template: string;
  source_mapping: SourceName[];
  example_patterns: string[];
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface HistoryUploadRecord {
  id: string;
  file_name: string;
  file_type: string;
  upload_mode: "append" | "replace";
  parsed_summary: unknown;
  created_at: string;
}

export interface SourceMonitorLog {
  id: string;
  source_name: SourceName;
  source_url: string;
  status: "success" | "warning" | "error" | "manual";
  http_status: number | null;
  message: string;
  checked_at: string;
}

export interface SourceValidationRow {
  source: SourceName;
  statusAkses: "Berhasil" | "Gagal" | "Manual";
  elementValid: "Ya" | "Tidak" | "Manual";
  dataBerhasilDitarik: "Ya" | "Tidak" | "Manual";
  catatan: string;
}

export interface GoldPriceRow {
  id: string;
  source_name: SourceName;
  source_url: string;
  jenis_emas: string;
  berat: string;
  harga: string | null;
  buyback: string | null;
  waktu_update: string | null;
  tanggal_update: string | null;
  delta: string | null;
  percentage_change: string | null;
  previous_snapshot_date?: string | null;
  previous_snapshot_run_time?: string | null;
}

export interface GoldPriceSnapshot {
  id: string;
  portal: Portal;
  jenis_konten: string;
  source_name: SourceName;
  source_url: string;
  run_time: string;
  update_time: string | null;
  jenis_emas: string;
  berat: string | null;
  harga_terbaru: string | null;
  harga_kemarin: string | null;
  buyback: string | null;
  delta: string | null;
  percentage_change: string | null;
  tanggal_snapshot: string;
  status: SourceRunStatus;
  catatan: string;
  price_rows: GoldPriceRow[];
}

export interface RunDataResponse {
  ok: boolean;
  portal: Portal;
  jenis_konten: string;
  selected_source?: SourceName | null;
  snapshots: GoldPriceSnapshot[];
  notifications: DashboardNotification[];
  partialFailure: boolean;
  disclaimer?: string;
}

export interface GeneratedArticle {
  headline: string;
  lead: string;
  body: string[];
  sourceLinks: string[];
  disclaimer?: string;
  rekomendasiAngle: string[];
}

export interface GenerateArticleResponse {
  ok: boolean;
  article?: GeneratedArticle;
  notifications: DashboardNotification[];
}
