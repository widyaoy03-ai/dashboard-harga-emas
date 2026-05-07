# Dashboard Workflow Harga Emas & Perak

Aplikasi full-stack Next.js untuk otomasi workflow redaksi konten repetitif "Harga Emas & Perak" pada portal Beritasatu dan Investor Daily.

## Pre-flight Validation

File yang sudah dipahami:

- `TEMPLATE ARTIKEL BERITASATU.docx`: 7 contoh artikel Beritasatu.
- `KUMPULAN TEMPLATE ARTIKEL INVESTOR DAILY.docx`: 6 contoh artikel Investor Daily.
- `LIST ARTIKEL HARGA EMAS.xlsx`: tab `INVESTOR DAILY` dan `BERITASATU`.
- `SOURCE.docx`: URL source dan element data per source.

Source otomatis valid:

- Logam Mulia
- Pegadaian
- Kitco
- Investing
- Raja Emas
- Laku Emas
- BSI
- Emas Kita
- Lotus Archi
- Indogold
- ShariaCoin

Source manual sementara:

- CNBC Metals
- Treasury
- Emasku
- Mini Gold (Instagram)
- HRTA Gold

Catatan operasional:

- Galeri24 diambil dari tabel Pegadaian.
- Source manual tidak menghentikan RUN DATA.
- Artikel tetap boleh dibuat dari source otomatis yang berhasil dengan disclaimer: "Sebagian source tidak berhasil dimuat. Artikel dibuat berdasarkan data yang tersedia."

## Stack

- Frontend: Next.js, React, Tailwind CSS
- Backend API: Next.js Route Handlers di Node.js
- State: React Query dan Zustand
- Database: PostgreSQL-ready via `DATABASE_URL`
- File parser: DOCX, XLSX, XLS, CSV

## Menjalankan

```bash
npm install
npm run dev
```

## Deploy ke Public Server

Project ini siap dipush ke GitHub dan dideploy ke Vercel. Vercel akan membaca struktur Next.js, menjalankan `npm install`, lalu `npm run build`.

Environment variable yang disarankan:

```bash
DATABASE_URL=postgresql://user:password@host:5432/database
DIRECT_URL=postgresql://user:password@host:5432/database
DATABASE_SSL=true
ADMIN_TOKEN=token-admin-yang-kuat
```

Catatan:

- `DATABASE_URL` wajib untuk public deployment agar histori, source, template, dan monitoring tidak hilang.
- `DIRECT_URL` opsional untuk migration/admin database. Runtime aplikasi membaca `DATABASE_URL`.
- `ADMIN_TOKEN` melindungi endpoint admin di URL publik. Isi token yang sama di field `ADMIN_TOKEN` pada tab `Pengaturan`.
- Tabel PostgreSQL dibuat otomatis saat API pertama kali dipakai. `prisma/schema.prisma` disediakan sebagai dokumentasi schema produksi.
- Cek koneksi database production melalui endpoint protected: `/api/admin/db-health` dengan header `x-admin-token: <ADMIN_TOKEN>`.

## Admin CMS

Tab `Pengaturan` berisi Admin CMS internal:

- Pengaturan Source: tambah source, edit URL, edit selector/keyword, mapping jenis konten, aktif/nonaktif source.
- Template Artikel: edit template Beritasatu dan Investor Daily, tambah contoh pola headline, aktif/nonaktif template.
- Upload Histori: upload DOCX/XLSX/XLS/CSV dengan mode append atau replace.
- Monitoring Source: cek akses source, validasi element, dan simpan error log.

Perubahan source dan template disimpan ke database dan langsung digunakan oleh `RUN DATA` serta `RUN ARTIKEL` tanpa redeploy.

## Flow Redeploy

1. Push perubahan code ke GitHub.
2. Hubungkan repository ke Vercel.
3. Set `DATABASE_URL`, `DATABASE_SSL`, dan `ADMIN_TOKEN`.
4. Vercel akan auto redeploy setiap ada update code.
5. Untuk revisi source/template harian, gunakan Admin CMS tanpa push code baru.

## Update UI/UX Setelah Live

Perubahan source, selector, template artikel, dan histori dapat dilakukan dari Admin CMS tanpa redeploy. Perubahan UI/UX, layout, menu, table, tooltip, atau logic aplikasi tetap perlu update code.

Alur update code:

```bash
git add .
git commit -m "revise dashboard logic"
git push origin main
```

Jika memakai GitHub web:

1. Upload file yang berubah ke repository.
2. Isi commit message, misalnya `revise dashboard logic`.
3. Commit ke branch `main`.
4. Buka Vercel project, tab `Deployments`.
5. Pastikan deployment terbaru berstatus `Ready`.
6. Buka URL `.vercel.app` dan cek fitur yang direvisi.
