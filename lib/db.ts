type PgClient = import("pg").Client;

const managedTables = [
  "gold_price_snapshots",
  "source_mapping_master",
  "article_templates",
  "article_drafts",
  "history_uploads",
  "source_monitor_logs"
];

export function hasDatabaseUrl() {
  return Boolean(process.env.DATABASE_URL);
}

export function getDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL belum dikonfigurasi.");
  }
  return databaseUrl;
}

export function dbSslConfig() {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (process.env.DATABASE_SSL === "false") return undefined;
  if (process.env.DATABASE_SSL === "true" || databaseUrl.includes("sslmode=require")) {
    return { rejectUnauthorized: false };
  }
  return undefined;
}

export function getDatabaseIdentity() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return {
      configured: false,
      host: null,
      database: null,
      user: null,
      isPooler: false
    };
  }

  try {
    const parsed = new URL(databaseUrl);
    return {
      configured: true,
      host: parsed.hostname,
      database: parsed.pathname.replace(/^\//, "") || null,
      user: decodeURIComponent(parsed.username || ""),
      isPooler: parsed.hostname.includes("-pooler.")
    };
  } catch {
    return {
      configured: true,
      host: "DATABASE_URL tidak dapat diparse",
      database: null,
      user: null,
      isPooler: false
    };
  }
}

export async function withDatabaseClient<T>(callback: (client: PgClient) => Promise<T>) {
  const { Client } = await import("pg");
  const client = new Client({
    connectionString: getDatabaseUrl(),
    ssl: dbSslConfig()
  });

  await client.connect();
  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}

export async function runDatabaseHealthCheck() {
  if (!hasDatabaseUrl()) {
    return {
      ok: false,
      connected: false,
      identity: getDatabaseIdentity(),
      message: "DATABASE_URL belum dikonfigurasi. Aplikasi akan fallback ke in-memory storage."
    };
  }

  const identity = getDatabaseIdentity();
  return withDatabaseClient(async (client) => {
    const connection = await client.query<{
      database_name: string;
      database_user: string;
      server_version: string;
      checked_at: string;
    }>(`
      SELECT
        current_database() AS database_name,
        current_user AS database_user,
        current_setting('server_version') AS server_version,
        NOW()::TEXT AS checked_at
    `);

    const tableResult = await client.query<{ table_name: string }>(
      `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = ANY($1::text[])
        ORDER BY table_name ASC
      `,
      [managedTables]
    );

    const existingTables = tableResult.rows.map((row) => row.table_name);
    const counts: Record<string, number | null> = {};
    for (const table of managedTables) {
      if (!existingTables.includes(table)) {
        counts[table] = null;
        continue;
      }
      const countResult = await client.query<{ count: string }>(`SELECT COUNT(*)::TEXT AS count FROM ${table}`);
      counts[table] = Number(countResult.rows[0]?.count ?? 0);
    }

    return {
      ok: true,
      connected: true,
      identity,
      connection: connection.rows[0],
      tables: {
        expected: managedTables,
        existing: existingTables,
        counts
      },
      message: "Koneksi PostgreSQL berhasil."
    };
  });
}
