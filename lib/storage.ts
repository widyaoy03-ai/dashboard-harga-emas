import type { GoldPriceSnapshot } from "./types";

let memorySnapshots: GoldPriceSnapshot[] = [];

function dbSslConfig() {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (process.env.DATABASE_SSL === "false") return undefined;
  if (process.env.DATABASE_SSL === "true" || databaseUrl.includes("sslmode=require")) {
    return { rejectUnauthorized: false };
  }
  return undefined;
}

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
}

export async function saveSnapshots(snapshots: GoldPriceSnapshot[]) {
  if (!snapshots.length) return;

  if (process.env.DATABASE_URL) {
    const { Client } = await import("pg");
    const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: dbSslConfig() });
    await client.connect();
    try {
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
    } finally {
      await client.end();
    }
    return;
  }

  memorySnapshots = [...memorySnapshots, ...snapshots];
}

export async function getHistoricalSnapshots() {
  if (process.env.DATABASE_URL) {
    const { Client } = await import("pg");
    const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: dbSslConfig() });
    await client.connect();
    try {
      await ensureTables(client);
      const result = await client.query<GoldPriceSnapshot>(
        "SELECT * FROM gold_price_snapshots ORDER BY run_time DESC LIMIT 500"
      );
      return result.rows.map((row) => ({
        ...row,
        price_rows: Array.isArray(row.price_rows) ? row.price_rows : []
      }));
    } finally {
      await client.end();
    }
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
