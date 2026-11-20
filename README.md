# Full Stack Open — Relational Databases

Backend blog dengan PostgreSQL, Sequelize, dan Express untuk Chapter 2–3 (latihan 1–17). Memerlukan Node.js 22+ dan Docker dengan Compose.

## Menjalankan

Dari root repository:

```bash
npm ci
cp .env.example .env
openssl rand -hex 24
openssl rand -hex 32
```

Gunakan hasil pertama sebagai `POSTGRES_PASSWORD` dan password pada kedua URL `DATABASE_URL` / `TEST_DATABASE_URL`. Gunakan hasil kedua sebagai `SECRET` untuk penandatanganan JWT. Jangan unggah `.env` atau kredensial asli ke Git.

```bash
npm run db:up
npm run db:seed
node cli.js
npm start
```

Default API: `http://127.0.0.1:3001`. `npm run dev` memakai watch mode bawaan Node.js. Aplikasi mengautentikasi koneksi, membuat tabel yang belum ada, menambahkan relasi bila diperlukan, lalu membuka HTTP server. Tidak menggunakan `sync({ force: true })` atau `sync({ alter: true })`.

Data PostgreSQL tersimpan di named volume. `npm run db:down` tidak menghapus volume. **`docker compose down -v` menghapus data database.** Password database ditetapkan saat volume pertama kali dibuat; mengedit `.env` saja tidak mengganti password database yang sudah ada.

## Database dan CLI

`commands.sql` membuat tabel awal Chapter 2 (`id`, `author`, `url`, `title`, `likes`) dan dua blog contoh. Skrip dapat diulang secara berurutan tanpa menggandakan dua contoh tersebut.

```bash
npm run db:psql
```

Di konsol psql:

```sql
\conninfo
\d blogs
\d users
SELECT id, author, title, likes, user_id FROM blogs ORDER BY id;
\q
```

Database hanya mendengarkan di `127.0.0.1:5432`. Setelah aplikasi Chapter 3 mulai, tabel `blogs` juga memiliki foreign key nullable `user_id` yang merujuk `users.id`. Dua blog lama tetap disimpan tanpa mengarang pemilik: responsnya memiliki `user: null`. Hanya pemilik yang dapat menghapus blog; blog lama tanpa pemilik tidak dapat dihapus melalui API.

User memiliki email unik sebagai `username`, `name` tidak kosong, hash password, serta timestamp otomatis `createdAt` dan `updatedAt`. Nama kolom SQL menggunakan snake_case. Blog tidak memiliki timestamp.

```bash
node cli.js
```

Contoh keluaran selain log SQL:

```text
Dan Abramov: 'On let vs const', 0 likes
Martin Fowler: 'Two Hard Things', 0 likes
```

CLI menutup koneksi setelah selesai dan memberikan exit code nonzero jika gagal.

## Endpoint

| Method | Endpoint | Perilaku |
| --- | --- | --- |
| GET | `/` | 200, `{ "status": "ok" }` |
| GET | `/api/blogs` | Semua blog beserta user pembuat; urut likes menurun |
| GET | `/api/blogs?search=react` | Cari substring title **atau** author, case-insensitive |
| GET | `/api/blogs/:id` | Satu blog beserta user pembuat |
| POST | `/api/blogs` | Buat blog milik user dari Bearer token; 201 |
| PUT | `/api/blogs/:id` | Mengubah **hanya** likes; 200 |
| DELETE | `/api/blogs/:id` | Wajib Bearer token milik pembuat; 204 |
| POST | `/api/users` | Daftar user dengan username/email, name, password; 201 |
| GET | `/api/users` | Semua user beserta blog yang dibuat |
| GET | `/api/users/:id` | User berdasarkan ID beserta blog |
| PUT | `/api/users/:username` | Ubah **name**; parameter adalah email/username, bukan ID |
| POST | `/api/login` | Verifikasi username + password, kembalikan JWT |
| GET | `/api/authors` | Statistik jumlah blog dan total likes per author |
| POST | `/api/reset` | **Hanya TESTING=true**, kosongkan kedua tabel database tes; 204 |

`title` dan `url` harus berupa string tidak kosong. `author` opsional. `likes` default `0` dan harus integer 32-bit bila dikirim. Klien tidak dapat memilih `id` atau memalsukan `userId`. Search memperlakukan karakter `%`, `_`, dan backslash sebagai substring literal, bukan wildcard SQL. Tanpa query search, tidak ada filter WHERE tambahan.

`/api/authors` menggunakan SQL `COUNT`, `SUM`, `GROUP BY`, dan `ORDER BY`, bukan agregasi di JavaScript. PostgreSQL mengembalikan count/sum sebagai string, misalnya:

```json
[
  { "author": "Example Author", "blogs": "3", "likes": "12" }
]
```

### Daftar, login, buat blog

```bash
curl -X POST http://127.0.0.1:3001/api/users \
  -H 'Content-Type: application/json' \
  -d '{"username":"reader@example.com","name":"Example Reader","password":"choose-a-long-password"}'

curl -X POST http://127.0.0.1:3001/api/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"reader@example.com","password":"choose-a-long-password"}'
```

Salin nilai `token` dari respons login ke variabel shell lokal:

```bash
read -r -s -p 'Token: ' TOKEN; printf '\n'

curl -X POST http://127.0.0.1:3001/api/blogs \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"author":"Example Author","title":"Belajar PostgreSQL","url":"https://example.com/post"}'

# Ganti BLOG_ID dengan id dari respons POST.
curl -X PUT http://127.0.0.1:3001/api/blogs/BLOG_ID \
  -H 'Content-Type: application/json' -d '{"likes":3}'

curl -i -X DELETE http://127.0.0.1:3001/api/blogs/BLOG_ID \
  -H "Authorization: Bearer $TOKEN"
```

Semua error HTTP ditangani di `util/middleware.js`. Formatnya `{ "error": ["pesan"] }`: input invalid/email duplikat `400`, token atau kredensial salah `401`, penghapusan oleh bukan pemilik `403`, resource tidak ada `404`. Detail SQL dan kredensial tidak dikirim ke klien.

Password minimal 8 karakter, maksimal 1024 byte; hash menggunakan `scrypt` dengan salt acak. Password dan hash tidak muncul pada respons. Token HS256 berlaku satu jam dan membutuhkan `SECRET` acak minimal 32 karakter pada mode normal. Tidak ada logout/revocation/session database sebelum fitur bab berikutnya.

**Batas cakupan:** sesuai latihan, PUT likes dan PUT name belum memerlukan autentikasi. Pembaruan user mengubah name, bukan email/username. Endpoint registrasi dan GET users bisa diakses tanpa login. Batasi akses jaringan; jangan menganggap ini sistem akun production lengkap.

## Akses Tailscale atau SSH

Untuk membuka API pada perangkat dalam tailnet yang diizinkan, isi `HOST` di `.env` dengan IPv4 Tailscale mesin ini (`tailscale ip -4`), lalu restart `npm start`. Akses `http://IP_TAILSCALE:3001/api/blogs`. Tidak perlu memakai `0.0.0.0` atau membuka port ke internet. PostgreSQL tetap di localhost.

Bila memakai default `HOST=127.0.0.1`, jalankan SSH tunnel dari laptop:

```bash
ssh -L 3001:127.0.0.1:3001 USER@VPS_IP
```

Lalu buka `http://127.0.0.1:3001/api/blogs` di laptop. Untuk frontend Part 5 pada port berbeda, gunakan dev-server proxy `/api` agar same-origin.

## Pengujian

Buat database tes sekali (lewati jika sudah ada):

```bash
npm run db:test:create
```

Isi `TEST_DATABASE_URL` di `.env`, misalnya database `blogdb_test`. Saat `TESTING=true`, aplikasi hanya memakai URL tersebut dan selalu bind ke localhost meskipun server normal memakai Tailscale. Nama database harus `test_db` atau berakhiran `_test`, berbeda dari database aplikasi. Reset tidak tersedia pada server normal.

**Database tes bersifat disposable. Reset dan tes integrasi menghapus semua baris blogs dan users di database tes. Jangan memakai database berisi data penting.** Tidak ada reset sequence, sehingga token lama tidak bisa cocok dengan ID user baru setelah reset.

### Tes resmi Chapter 3

Terminal pertama:

```bash
npm run start:test
```

Terminal kedua:

```bash
npm test
```

Tes resmi memanggil `http://localhost:3001`. Jangan jalankan server normal di **alamat localhost dan port yang sama** pada saat bersamaan; server normal yang bind hanya ke IP Tailscale dapat tetap berjalan.

`tests/api_ch3.test.js`, `tests/api_ch4.test.js`, dan `tests/helper.js` disalin tanpa perubahan dari `fullstack-hy2020/tests`, direktori `fs-psql`, commit `e5600257de16a90365465e4e50944241c94e0d6a`. Berkas Chapter 4 ikut disimpan sesuai struktur upstream tetapi **tidak dijalankan** oleh script Chapter 3 karena reading lists dan sessions belum termasuk cakupan ini.

### Tes tambahan

Hentikan server tes sebelum menjalankan tes integrasi, karena tes integrasi memakai database tes yang sama:

```bash
npm run test:config
npm run test:integration
npm audit
```

Tes integrasi membuka HTTP server sendiri pada port acak. Cakupan: validasi blog/user, email unik, timestamp, password, JWT, kepemilikan, pencarian, urutan likes, agregasi author, constraint PostgreSQL, CLI, dan reset. Tes konfigurasi tidak memerlukan koneksi database.

### CI

`.github/workflows/test.yml` diadaptasi dari workflow upstream. Pada push ke `main`/`master` atau pull request ke branch tersebut, GitHub Actions menyiapkan PostgreSQL 17 dengan database tes, menginstal dependency dari lockfile, menjalankan tes konfigurasi dan integrasi, lalu menyalakan `start:test` dan menjalankan tes resmi Chapter 3. Workflow juga bisa dijalankan manual. Password CI hanya kredensial fixture untuk service sementara, bukan database server.

## Database hosted

Ganti `DATABASE_URL`, set `DATABASE_SSL=true`, dan gunakan `DATABASE_CA_CERT` bila penyedia memberi CA certificate. Verifikasi TLS tetap aktif. Hindari parameter SSL yang bertentangan di URL. Docker lokal menggunakan `DATABASE_SSL=false`.

## Struktur

```text
index.js                 Koneksi database dan lifecycle server
app.js                   Router dan middleware Express
models/index.js          Asosiasi user/blog dan sinkronisasi aman
models/blog.js           Model blog tanpa timestamp
models/user.js           Email unik, hash password, timestamp
controllers/blogs.js     CRUD blog, pencarian, urutan likes
controllers/users.js     Create/list/detail/update name
controllers/login.js     Login JWT
controllers/authors.js   Statistik SQL per author
controllers/reset.js     Reset khusus database tes
util/config.js           Environment, pemisahan database, TLS
util/db.js               Koneksi Sequelize
util/middleware.js       Verifikasi token dan error handler
util/password.js         Hash dan verifikasi scrypt
util/validation.js       Validasi request bersama
commands.sql             Schema awal dan dua contoh blog
cli.js                   Pembaca blog di console
compose.yaml             PostgreSQL dengan volume persisten
tests/                   Tes resmi dan integrasi tambahan
.github/workflows/       GitHub Actions
```

`package-lock.json` mengunci dependency. Override `uuid` untuk Sequelize memakai versi `11.1.1` yang mendukung CommonJS dan menutup advisory pada versi lama.
