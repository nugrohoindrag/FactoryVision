# FactoryVision

WMS untuk pabrik IKM. Offline-first, PWA, satu build untuk PC · laptop · tablet · HP.

Dokumen yang mengikat ada di [`docs/`](docs/):
[PRD](docs/PRD-WMS-Manufaktur.md) · [UI Specification](docs/UI-Specification.md) (sumber kebenaran desain) ·
[UI Development Plan](docs/UI-Development-Plan.md) (papan tugas UI) ·
[Backend Development Plan](docs/Backend-Development-Plan.md) (papan tugas backend) ·
[Design System](docs/DESIGN_SYSTEM_FINAL.md) · [Tech Stack](docs/Tech-Stack.md)

## Struktur

```
apps/wms/           React + Vite + Tailwind, PWA — dua shell (Lapangan & Kantor)
apps/api/           NestJS (Fastify) + Prisma + MySQL — ingest event, projeksi, laporan
packages/contracts/ Skema Zod, tipe event, rantai hash & UUIDv7 — dipakai klien DAN server
packages/domain/    Logika murni: projeksi stok, hitung bon, konversi satuan, FEFO
packages/tokens/    globals.css + preset Tailwind, dipakai wms & landing
```

`packages/domain` bebas React dan bebas DB — fungsi murni yang diuji tanpa merender apa pun.
Kalau projeksi stok salah, setiap layar akan menampilkan angka yang salah dengan meyakinkan,
jadi ia dibangun dan diuji sebelum layar mana pun (Tech Stack §7).

## Menjalankan

```bash
pnpm install
pnpm dev              # apps/wms di http://localhost:5173
pnpm --filter @fv/api dev   # backend di http://localhost:3000 (butuh MySQL)
pnpm test             # uji unit seluruh workspace
pnpm typecheck
pnpm --filter @fv/wms build
pnpm --filter @fv/wms size           # anggaran JS, CSS, precache SW
pnpm --filter @fv/wms audit:design   # nol warna/ukuran keras, nol istilah keras
pnpm --filter @fv/wms e2e            # Playwright di 360 · 768 · 1024 · 1440
```

Butuh Node ≥20 dan pnpm 11. Sekali di awal: `pnpm --filter @fv/wms exec playwright install chromium`.

### Kenapa `pnpm` terdaftar sebagai devDependency

Terlihat ganjil — pnpm mengelola dirinya sendiri — tapi ini yang membuat deploy bisa jalan.
Script di root seperti `"build": "pnpm -r build"` memanggil `pnpm` lagi dari dalam sebuah shell.
Shell itu hanya mewarisi `node_modules/.bin` pada PATH-nya, **bukan** PATH sistem. Di laptop
hal ini tidak pernah terasa karena pnpm kebetulan terpasang global; di Hostinger pnpm datang
lewat corepack dan tidak pernah sampai ke proses anak, sehingga setiap deploy berhenti di
`sh: line 1: pnpm: command not found`. Mendaftarkannya sebagai dependensi menempatkan sebuah
shim di `node_modules/.bin`, dan script root pun jalan di mana saja.

Versinya dipaku sama persis dengan `packageManager`. Kalau salah satu dinaikkan, naikkan
keduanya — dua pnpm yang berbeda pendapat adalah kegagalan deploy yang sudah pernah terjadi.
Backend butuh MySQL — cara menyalakannya ada di [`apps/api/README.md`](apps/api/README.md).
MySQL ini **sementara**, mengikuti batasan Hostinger shared hosting; PostgreSQL tetap tujuan
akhirnya dan versinya tersimpan utuh di branch `postgres-version`.

## Aturan yang tidak boleh dilanggar

Lima hal ini bukan preferensi gaya — masing-masing punya konsekuensi konkret di lantai gudang.

1. **Kuantitas tidak pernah `number`.** String desimal, dihitung lewat `@fv/domain` (big.js).
   `number` hanya muncul di lapisan format tampilan. `0.1 + 0.2 !== 0.3` berarti bon tidak
   pernah tertutup bersih, dan laporan varians jadi tidak dipercaya (Tech Stack §2.4)
2. **Tidak ada label ditulis langsung di JSX.** Semua lewat `useTerm()` — istilah adalah
   konfigurasi per-tenant, Inggris hanya nilai bawaan (PRD §9.2)
3. **Tidak ada nilai warna/ukuran keras.** Semua lewat token semantik di `packages/tokens`.
   Pewarnaan solid: nol gradasi, nol opasitas untuk menyampaikan makna (UI Spec §6.4)
4. **Layar menulis event, bukan angka turunan.** Satu jalur tulis: `appendEvent()`. Stok,
   saldo bon, dan status semuanya diprojeksikan dari event log
5. **Satu projeksi, dua runtime.** `packages/domain` dipakai apa adanya oleh klien dan server.
   Kalau sebuah fungsi tidak bisa dipakai apa adanya, yang diperbaiki adalah fungsinya — bukan
   ditulis ulang di sisi server. Dua versi angka stok akan berselisih, dan yang kalah selalu yang
   dilihat operator (dibuktikan uji paritas di `apps/api/test/ingest.test.ts`)

Urutan pengambilan komponen wajib diikuti (UI Spec §5.1): komponen domain yang sudah ada →
Design System §5 → shadcn lewat CLI → komponen baru (dan didaftarkan balik ke Design System).

## Status

**Frontend: 45 layar P0 terbangun.** **Backend: 85 dari 92 tugas selesai, Gate B0–B7.**

| | |
|---|---|
| Uji | 263 unit & integrasi (109 domain · 63 klien · 91 backend) + 189 E2E |
| JS awal | 192,6 KB gzip dari anggaran 200 KB |
| Precache SW | 1,07 MB dari 5 MB |
| Layar stok di 3G | **530 ms** terpasang · 2.020 ms muat dingin pertama |
| Simpan transaksi lokal | 2 ms dari anggaran 200 ms |

Backend menjalankan seluruh cakupan P0: ingest event idempoten dengan verifikasi rantai hash,
projeksi server yang **terbukti identik** dengan projeksi perangkat, sinkronisasi dua arah untuk
30 pengguna dalam satu pabrik, sepuluh laporan, dan jejak audit yang ditolak database untuk
disunting. Rinciannya di [papan tugas backend](docs/Backend-Development-Plan.md) dan
[runbook](docs/Backend-Runbook.md).

**Yang terblokir, dan kenapa:**

| Tugas | Butuh |
|---|---|
| T-007 `browserslist` | Versi Chrome nyata di HP operator (P-04) |
| T-030 suite regresi impor | 30 file Excel gudang asli (P-01) |
| T-035 uji lapangan | Akses ke 3 pabrik mitra (P-05) |
| T-104 buang pemilih peran | ~~Autentikasi backend~~ — **terbuka**, Gate B1 lolos |

**Gate S1 belum dapat dinyatakan lolos** — target ≤20 detik (L06) dan <30 detik (L13) hanya sah bila
diukur di gudang asli dengan sarung tangan. Instrumen waktunya sudah aktif di build internal dan siap
dipakai di lapangan. Rinciannya di [papan tugas](docs/UI-Development-Plan.md).
