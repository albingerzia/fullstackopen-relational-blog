# Full Stack Open — Relational Databases, Chapter 2

Backend blog dengan PostgreSQL, Sequelize, dan Express. Mencakup latihan 1–4, bukan aplikasi notes dari contoh materi. Memerlukan Node.js 22+ dan Docker dengan Compose.

## Menjalankan dari awal

Jalankan dari root repository:

```bash
npm ci
cp .env.example .env
openssl rand -hex 24
```

Masukkan hasil password acak tersebut ke **dua bagian** di `.env`: `POSTGRES_PASSWORD` dan password pada `DATABASE_URL`. Gunakan password yang sama juga untuk `TEST_DATABASE_URL` bila ingin menjalankan tes. Jangan unggah `.env` ke GitHub.

```bash
npm run db:up
npm run db:seed
node cli.js
npm start
```

`npm start` akan menghubungkan aplikasi ke PostgreSQL, membuat tabel yang belum ada dengan `sequelize.sync()` (tanpa menghapus atau mengubah tabel yang sudah ada), lalu membuka API di `http://127.0.0.1:3001`. Untuk development, gunakan `npm run dev`.

Docker menyimpan data di named volume, sehingga `npm run db:down` tidak menghapus data. **Jangan gunakan `docker compose down -v` kecuali memang ingin menghapus database.** Password database ditetapkan saat volume pertama kali dibuat; mengubah `.env` saja tidak mengganti password database yang sudah ada.

## Latihan 1 — Repository dan koneksi psql

Buka konsol PostgreSQL:

```bash
npm run db:psql
```

Coba perintah berikut di dalam `psql`:

```sql
\conninfo
\d
\d blogs
SELECT * FROM blogs ORDER BY id;
\q
```

Database hanya dipublikasikan di `127.0.0.1:5432`, bukan internet. Koneksi aplikasi menggunakan `DATABASE_URL` di `.env`.

## Latihan 2 — commands.sql

File `commands.sql` di root membuat tabel:

| Kolom | Tipe | Aturan |
| --- | --- | --- |
| id | SERIAL | PRIMARY KEY, otomatis bertambah |
| author | TEXT | Opsional |
| url | TEXT | NOT NULL |
| title | TEXT | NOT NULL |
| likes | INTEGER | DEFAULT 0 |

File itu juga menambahkan dua blog. Jalankan dengan `npm run db:seed`; perintah ini mengirim file SQL ke **psql** di container. Skrip dapat dijalankan ulang tanpa menggandakan dua data contoh tersebut (selama dijalankan satu per satu).

## Latihan 3 — cli.js

```bash
node cli.js
```

Contoh keluaran selain log SQL Sequelize:

```text
Dan Abramov: 'On let vs const', 0 likes
Martin Fowler: 'Two Hard Things', 0 likes
```

CLI menutup koneksi database setelah selesai dan mengembalikan exit code nonzero jika koneksi/query gagal.

## Latihan 4 — Web service

```bash
npm start
```

| Method | Endpoint | Hasil |
| --- | --- | --- |
| GET | `/api/blogs` | 200, array semua blog |
| POST | `/api/blogs` | 201, blog yang tersimpan |
| DELETE | `/api/blogs/:id` | 204, tanpa body |

POST mewajibkan `title` dan `url` berupa string tidak kosong. `author` opsional. `likes` opsional, default `0`, dan bila dikirim harus integer 32-bit. Field tambahan, termasuk `id` dari klien, diabaikan. Tidak ada kolom `createdAt`/`updatedAt`.

```bash
curl http://127.0.0.1:3001/api/blogs

curl -X POST http://127.0.0.1:3001/api/blogs \
  -H 'Content-Type: application/json' \
  -d '{"author":"Example Author","title":"Belajar PostgreSQL","url":"https://example.com/post"}'

# Ganti 3 dengan id dari respons POST. Ini menghapus blog tersebut.
curl -i -X DELETE http://127.0.0.1:3001/api/blogs/3
```

Input invalid menghasilkan `400` dengan JSON `{ "error": "..." }`. Blog yang tidak ditemukan saat DELETE menghasilkan `404`. Error internal tidak membocorkan detail SQL/kredensial.

### Mengakses dari laptop ketika backend berjalan di VPS

API belum memiliki autentikasi/otorisasi karena belum diminta dalam latihan ini. Siapa pun yang bisa menjangkau API dapat menambah atau menghapus blog. Default `HOST=127.0.0.1` sengaja menjaga API tetap lokal; jangan membuka portnya langsung ke internet.

Gunakan SSH tunnel dari laptop (ganti `USER` dan `VPS_IP`):

```bash
ssh -L 3001:127.0.0.1:3001 USER@VPS_IP
```

Kemudian akses `http://127.0.0.1:3001/api/blogs` di laptop. Endpoint dan format JSON sesuai latihan; autentikasi pengguna, PUT likes, dan fitur bab berikutnya belum termasuk. Untuk frontend Part 5 yang berjalan di port lain, arahkan `/api` melalui dev-server proxy ke backend agar tetap same-origin.

## Pengujian

Tes memakai database terpisah. Buat sekali:

```bash
npm run db:test:create
```

Isi `TEST_DATABASE_URL` di `.env` dengan password yang sama, menggunakan database `blogdb_test`, lalu jalankan:

```bash
npm test
```

Runner menolak URL database tes tanpa akhiran `_test` dan menolak URL yang menunjuk database aplikasi. **Semua baris tabel `blogs` pada database tes akan dibersihkan setiap tes.** Jangan pakai database berisi data penting. Tes mencakup GET/POST/DELETE melalui HTTP sungguhan, validasi, error JSON, constraint PostgreSQL, default likes, dan keluaran CLI. PostgreSQL harus sudah berjalan.

## Dependency dan keamanan

`package-lock.json` mengunci versi dependency. Mode development menggunakan `node --watch` bawaan Node.js, sehingga tidak membutuhkan nodemon. Dependency `uuid` milik Sequelize dioverride ke versi `11.1.1` yang mendukung CommonJS untuk menghindari advisory buffer bounds pada versi lama. Jalankan `npm audit` untuk memeriksa advisory terbaru.

## Database hosted (opsional)

Untuk penyedia PostgreSQL seperti Aiven, ganti `DATABASE_URL` dengan connection URL milikmu dan set `DATABASE_SSL=true`. Jika penyedia memberi CA certificate, simpan file tersebut secara lokal dan isi `DATABASE_CA_CERT` dengan path-nya. Verifikasi sertifikat TLS tetap aktif. Hindari parameter SSL yang bertentangan di connection URL; gunakan konfigurasi SSL di `.env`. Docker lokal menggunakan `DATABASE_SSL=false`.

## Berkas penting

```text
commands.sql           SQL tabel dan dua blog contoh
cli.js                 Pembaca blog di console
index.js               Koneksi database dan HTTP server
app.js                 Express dan error handling
controllers/blogs.js   GET / POST / DELETE
models/blog.js         Model Sequelize
util/config.js         Environment dan TLS
util/db.js             Koneksi dan sinkronisasi schema
compose.yaml           PostgreSQL dengan volume persisten
tests/blogs.test.js     Tes integrasi HTTP, SQL, dan CLI
```
