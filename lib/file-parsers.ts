export async function parseUploadedFile(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const lowerName = file.name.toLowerCase();

  if (lowerName.endsWith(".docx")) {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return {
      type: "docx",
      fileName: file.name,
      characterCount: result.value.length,
      preview: result.value.slice(0, 1200)
    };
  }

  if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls") || lowerName.endsWith(".csv")) {
    const xlsx = await import("xlsx");
    const workbook = xlsx.read(buffer, { type: "buffer" });
    const sheets = workbook.SheetNames.map((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      const rows = xlsx.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null }).slice(0, 20);
      return { sheetName, sampleRows: rows };
    });
    return {
      type: "spreadsheet",
      fileName: file.name,
      sheets
    };
  }

  throw new Error("Format file belum didukung. Gunakan DOCX, XLSX, XLS, atau CSV.");
}
