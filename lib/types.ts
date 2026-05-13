export type Portal = "Beritasatu" | "Investor Daily";

export type NotificationKind = "success" | "warning" | "error" | "info";

export type SourceRunStatus = "success" | "warning" | "error" | "manual";

export type SourceName = string;

export type SourceParserType = "generic-table" | "logam-mulia";

export interface SourceFieldMapping {
  weightIndex?: number;
  priceIndex?: number;
  basePriceIndex?: number;
  pricePph025Index?: number;
  productTypeIndex?: number;
}

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
  parserType?: SourceParserType;
  titleSelector?: string;
  dataSelector?: string;
  rowSelector?: string;
  fieldMapping?: SourceFieldMapping;
  timestampSelector?: string;
  elementKeywords: string[];
  includeKeywords?: string[];
  excludeKeywords?: string[];
  boundaryStartKeywords?: string[];
  boundaryStopKeywords?: string[];
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
  product_type?: string | null;
  weight?: string | null;
  base_price?: number | null;
  price_pph_025?: number | null;
  source?: SourceName;
  scraped_at?: string | null;
  section_name?: string | null;
  category?: string | null;
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
  selected_sources?: SourceName[];
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
}

export interface GenerateArticleResponse {
  ok: boolean;
  article?: GeneratedArticle;
  draft?: ArticleDraftRecord;
  notifications: DashboardNotification[];
}

export type DraftStatus = "Pending Review" | "Revision Need" | "Approved" | "Rejected";
export type DataStatus = "Success" | "Partial Success" | "Failed";

export interface DraftSourceDetail {
  source_name: SourceName;
  status: SourceRunStatus;
  catatan: string;
  row_count: number;
}

export interface ArticleDraftRecord {
  id: string;
  portal: Portal;
  jenis_konten: string;
  title: string;
  lead: string;
  body: string[];
  source_links: string[];
  date: string;
  generated_at: string;
  triggered_by: string;
  assigned_editor: string;
  data_status: DataStatus;
  status_draft: DraftStatus;
  source_details: DraftSourceDetail[];
  review_note: string | null;
  review_note_updated_at: string | null;
  review_note_updated_by: string | null;
  created_at?: string;
  updated_at?: string;
}
