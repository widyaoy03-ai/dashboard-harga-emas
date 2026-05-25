import type { GoldPriceRow, GoldPriceSnapshot, SourceDataColumn, SourceDataView } from "./types";

function rowPriceCurrency(row: GoldPriceRow) {
  return row.harga?.startsWith("US$") ? "USD" : "IDR";
}

function hasValue(value: unknown) {
  return value !== null && value !== undefined && value !== "";
}

function isWorldMetricSource(sourceName: string) {
  return /kitco|investing|cnbc/i.test(sourceName);
}

function isRajaEmasSource(sourceName: string) {
  return /raja\s*emas/i.test(sourceName);
}

function isLakuEmasSource(sourceName: string) {
  return /laku\s*emas/i.test(sourceName);
}

function isLogamMuliaSnapshot(snapshot: GoldPriceSnapshot) {
  return (
    /logam\s*mulia/i.test(snapshot.source_name) ||
    snapshot.price_rows.some((row) => hasValue(row.price_pph_025))
  );
}

function priceColumn(key: string, label: string): SourceDataColumn {
  return { key, label, align: "right", type: "price" };
}

function textColumn(key: string, label: string): SourceDataColumn {
  return { key, label, align: "left", type: "text" };
}

function buildRowsForGeneric(snapshot: GoldPriceSnapshot) {
  const rows = snapshot.price_rows;
  const columns: SourceDataColumn[] = [textColumn("item", "Item")];
  const includeHarga = rows.some((row) => hasValue(row.harga));
  const includeBuyback = rows.some((row) => hasValue(row.buyback));
  const includeDelta = rows.some((row) => hasValue(row.delta));
  const includePercentage = rows.some((row) => hasValue(row.percentage_change));

  if (includeHarga) columns.push(priceColumn("harga", "Harga"));
  if (includeBuyback) columns.push(priceColumn("buyback", "Buyback"));
  if (includeDelta) columns.push({ key: "delta", label: "Delta", align: "right", type: "text" });
  if (includePercentage) columns.push({ key: "percentage_change", label: "% Perubahan", align: "right", type: "percent" });

  return {
    columns,
    rows: rows.map((row) => ({
      item: row.weight ?? row.berat,
      harga: row.harga,
      buyback: row.buyback,
      delta: row.delta,
      percentage_change: row.percentage_change
    }))
  };
}

function buildSourceSpecificRows(snapshot: GoldPriceSnapshot) {
  const rows = snapshot.price_rows;

  if (isLogamMuliaSnapshot(snapshot)) {
    const columns = [textColumn("weight", "Berat"), priceColumn("base_price", "Harga Dasar"), priceColumn("price_pph_025", "Harga + PPh 0.25%")];
    return {
      columns,
      rows: rows.map((row) => ({
        weight: row.weight ?? row.berat,
        base_price: row.base_price ?? null,
        price_pph_025: row.price_pph_025 ?? null
      }))
    };
  }

  if (isWorldMetricSource(snapshot.source_name)) {
    const columns = [textColumn("metric", "Metric"), priceColumn("value", "Value")];
    return {
      columns,
      rows: rows.map((row) => ({
        metric: row.jenis_emas || row.weight || row.berat || "Harga spot",
        value: row.harga
      }))
    };
  }

  if (isRajaEmasSource(snapshot.source_name)) {
    const columns = [textColumn("kadar_karat", "Kadar Karat"), priceColumn("harga_per_gram", "Harga per Gram")];
    return {
      columns,
      rows: rows.map((row) => ({
        kadar_karat: row.weight ?? row.berat,
        harga_per_gram: row.harga
      }))
    };
  }

  if (isLakuEmasSource(snapshot.source_name)) {
    const columns = [textColumn("kadar", "Kadar"), priceColumn("harga_jual_per_gram", "Harga Jual / Gram")];
    return {
      columns,
      rows: rows.map((row) => ({
        kadar: row.weight ?? row.berat,
        harga_jual_per_gram: row.harga
      }))
    };
  }

  return buildRowsForGeneric(snapshot);
}

export function buildSourceDataViews(snapshots: GoldPriceSnapshot[]): SourceDataView[] {
  return snapshots.map((snapshot) => {
    const { columns, rows } = snapshot.status === "success" ? buildSourceSpecificRows(snapshot) : { columns: [] as SourceDataColumn[], rows: [] };
    const firstRow = snapshot.price_rows[0];
    return {
      source: snapshot.source_name,
      source_url: snapshot.source_url,
      status: snapshot.status,
      update_time: snapshot.update_time,
      run_time: snapshot.run_time,
      row_count: rows.length,
      schema: columns.map((column) => column.key),
      columns,
      rows,
      message: snapshot.catatan,
      currency: firstRow ? rowPriceCurrency(firstRow) : "IDR"
    };
  });
}
