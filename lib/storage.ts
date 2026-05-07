import { hasDatabaseUrl, withDatabaseClient } from "./db";
import type { ArticleDraftRecord, DraftStatus, GoldPriceSnapshot } from "./types";

let memorySnapshots: GoldPriceSnapshot[] = [];
let memoryDrafts: ArticleDraftRecord[] = [];

async function ensureTables(client: import("pg").Client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS gold_price_snapshots (
      id TEXT PRIMARY KEY,
      portal TEXT NOT NULL,
      jenis_konten TEXT NOT NULL,
      source_name TEXT NOT NULL,
      source_url TEXT NOT NULL,
      run_time TIMESTAMPTZ NOT NULL,
      update_time TEXT,
      jenis_emas TEXT,
      berat TEXT,
      harga_terbaru TEXT,
      harga_kemarin TEXT,
      buyback TEXT,
      delta TEXT,
      percentage_change TEXT,
      tanggal_snapshot DATE NOT NULL,
      status TEXT NOT NULL,
      catatan TEXT,
      price_rows JSONB
    );
  `);
  await client.query("ALTER TABLE gold_price_snapshots ADD COLUMN IF NOT EXISTS buyback TEXT;");
  await client.query("ALTER TABLE gold_price_snapshots ADD COLUMN IF NOT EXISTS price_rows JSONB;");
  await client.query(`
    CREATE TABLE IF NOT EXISTS article_drafts (
      id TEXT PRIMARY KEY,
      portal TEXT NOT NULL,
      jenis_konten TEXT NOT NULL,
      title TEXT NOT NULL,
      lead TEXT NOT NULL,
      body JSONB NOT NULL DEFAULT '[]'::jsonb,
      source_links JSONB NOT NULL DEFAULT '[]'::jsonb,
      date DATE NOT NULL,
      generated_at TIMESTAMPTZ NOT NULL,
      triggered_by TEXT NOT NULL,
      assigned_editor TEXT NOT NULL,
      data_status TEXT NOT NULL,
      status_draft TEXT NOT NULL DEFAULT 'Pending Review',
      source_details JSONB NOT NULL DEFAULT '[]'::jsonb,
      review_note TEXT,
      review_note_updated_at TIMESTAMPTZ,
      review_note_updated_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

export async function saveSnapshots(snapshots: GoldPriceSnapshot[]) {
  if (!snapshots.length) return;

  if (hasDatabaseUrl()) {
    await withDatabaseClient(async (client) => {
      await ensureTables(client);
      for (const snapshot of snapshots) {
        await client.query(
          `INSERT INTO gold_price_snapshots (
            id, portal, jenis_konten, source_name, source_url, run_time, update_time,
            jenis_emas, berat, harga_terbaru, harga_kemarin, buyback, delta, percentage_change,
            tanggal_snapshot, status, catatan, price_rows
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
          ON CONFLICT (id) DO NOTHING`,
          [
            snapshot.id,
            snapshot.portal,
            snapshot.jenis_konten,
            snapshot.source_name,
            snapshot.source_url,
            snapshot.run_time,
            snapshot.update_time,
            snapshot.jenis_emas,
            snapshot.berat,
            snapshot.harga_terbaru,
            snapshot.harga_kemarin,
            snapshot.buyback,
            snapshot.delta,
            snapshot.percentage_change,
            snapshot.tanggal_snapshot,
            snapshot.status,
            snapshot.catatan,
            JSON.stringify(snapshot.price_rows)
          ]
        );
      }
    });
    return;
  }

  memorySnapshots = [...memorySnapshots, ...snapshots];
}

export async function getHistoricalSnapshots() {
  if (hasDatabaseUrl()) {
    return withDatabaseClient(async (client) => {
      await ensureTables(client);
      const result = await client.query<Record<string, unknown>>(
        "SELECT * FROM gold_price_snapshots ORDER BY run_time DESC LIMIT 500"
      );
      return result.rows.map((row) => ({
        ...row,
        run_time: row.run_time instanceof Date ? row.run_time.toISOString() : row.run_time,
        tanggal_snapshot: row.tanggal_snapshot instanceof Date ? row.tanggal_snapshot.toISOString().slice(0, 10) : row.tanggal_snapshot,
        price_rows: Array.isArray(row.price_rows) ? row.price_rows : []
      })) as GoldPriceSnapshot[];
    });
  }

  return [...memorySnapshots].sort((a, b) => b.run_time.localeCompare(a.run_time));
}

export async function findPreviousSnapshot(current: GoldPriceSnapshot) {
  const all = await getHistoricalSnapshots();
  return all.find(
    (snapshot) =>
      snapshot.source_name === current.source_name &&
      snapshot.jenis_konten === current.jenis_konten &&
      snapshot.status === "success" &&
      snapshot.id !== current.id
  );
}

function draftFromRow(row: Record<string, unknown>): ArticleDraftRecord {
  return {
    id: String(row.id),
    portal: row.portal === "Beritasatu" ? "Beritasatu" : "Investor Daily",
    jenis_konten: String(row.jenis_konten),
    title: String(row.title ?? ""),
    lead: String(row.lead ?? ""),
    body: Array.isArray(row.body) ? row.body.map(String) : [],
    source_links: Array.isArray(row.source_links) ? row.source_links.map(String) : [],
    date: row.date instanceof Date ? row.date.toISOString().slice(0, 10) : String(row.date ?? ""),
    generated_at: row.generated_at instanceof Date ? row.generated_at.toISOString() : String(row.generated_at ?? ""),
    triggered_by: String(row.triggered_by ?? ""),
    assigned_editor: String(row.assigned_editor ?? ""),
    data_status: row.data_status === "Success" || row.data_status === "Failed" ? row.data_status : "Partial Success",
    status_draft: ["Pending Review", "Revision Need", "Approved", "Rejected"].includes(String(row.status_draft))
      ? (row.status_draft as DraftStatus)
      : "Pending Review",
    source_details: Array.isArray(row.source_details) ? (row.source_details as ArticleDraftRecord["source_details"]) : [],
    review_note: row.review_note ? String(row.review_note) : null,
    review_note_updated_at:
      row.review_note_updated_at instanceof Date ? row.review_note_updated_at.toISOString() : row.review_note_updated_at ? String(row.review_note_updated_at) : null,
    review_note_updated_by: row.review_note_updated_by ? String(row.review_note_updated_by) : null,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? ""),
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at ?? "")
  };
}

export async function saveArticleDraft(draft: ArticleDraftRecord) {
  if (hasDatabaseUrl()) {
    return withDatabaseClient(async (client) => {
      await ensureTables(client);
      await client.query(
        `INSERT INTO article_drafts (
          id, portal, jenis_konten, title, lead, body, source_links, date, generated_at,
          triggered_by, assigned_editor, data_status, status_draft, source_details,
          review_note, review_note_updated_at, review_note_updated_by, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          lead = EXCLUDED.lead,
          body = EXCLUDED.body,
          source_links = EXCLUDED.source_links,
          assigned_editor = EXCLUDED.assigned_editor,
          data_status = EXCLUDED.data_status,
          status_draft = EXCLUDED.status_draft,
          source_details = EXCLUDED.source_details,
          review_note = EXCLUDED.review_note,
          review_note_updated_at = EXCLUDED.review_note_updated_at,
          review_note_updated_by = EXCLUDED.review_note_updated_by,
          updated_at = NOW()`,
        [
          draft.id,
          draft.portal,
          draft.jenis_konten,
          draft.title,
          draft.lead,
          JSON.stringify(draft.body),
          JSON.stringify(draft.source_links),
          draft.date,
          draft.generated_at,
          draft.triggered_by,
          draft.assigned_editor,
          draft.data_status,
          draft.status_draft,
          JSON.stringify(draft.source_details),
          draft.review_note,
          draft.review_note_updated_at,
          draft.review_note_updated_by
        ]
      );
      const result = await client.query("SELECT * FROM article_drafts WHERE id = $1 LIMIT 1", [draft.id]);
      return draftFromRow(result.rows[0]);
    });
  }

  memoryDrafts = [draft, ...memoryDrafts.filter((item) => item.id !== draft.id)];
  return draft;
}

export async function getArticleDrafts() {
  if (hasDatabaseUrl()) {
    return withDatabaseClient(async (client) => {
      await ensureTables(client);
      const result = await client.query<Record<string, unknown>>("SELECT * FROM article_drafts ORDER BY generated_at DESC LIMIT 200");
      return result.rows.map(draftFromRow);
    });
  }

  return [...memoryDrafts].sort((a, b) => b.generated_at.localeCompare(a.generated_at));
}

export async function updateArticleDraft(
  id: string,
  patch: Partial<Pick<ArticleDraftRecord, "title" | "lead" | "body" | "status_draft" | "assigned_editor" | "review_note" | "review_note_updated_by">>
) {
  const current = (await getArticleDrafts()).find((draft) => draft.id === id);
  if (!current) return null;
  const shouldStampNote =
    patch.review_note !== undefined || patch.review_note_updated_by !== undefined || patch.status_draft === "Revision Need" || patch.status_draft === "Rejected";
  return saveArticleDraft({
    ...current,
    ...patch,
    review_note: patch.review_note !== undefined ? patch.review_note : current.review_note,
    review_note_updated_at: shouldStampNote ? new Date().toISOString() : current.review_note_updated_at,
    review_note_updated_by: patch.review_note_updated_by ?? current.review_note_updated_by,
    updated_at: new Date().toISOString()
  });
}
