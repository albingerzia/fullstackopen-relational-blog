# Full Stack Open — Relational Databases

Backend blog dengan PostgreSQL, Sequelize, dan Express untuk Chapter 2–4 (latihan 1–27). Memerlukan Node.js 22+ dan Docker dengan Compose.

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
npm run migration:up
npm run db:seed
node cli.js
npm start
```

Default API: `http://127.0.0.1:3001`. `npm run dev` memakai watch mode bawaan Node.js. Aplikasi mengautentikasi koneksi, menjalankan pending migrations melalui Umzug, lalu membuka HTTP server. Tidak ada pemanggilan sinkronisasi schema model. Jalankan migrations **sebelum** seed; `commands.sql` disimpan sebagai berkas historis Chapter 2, bukan pengganti migrations.

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

Database hanya mendengarkan di `127.0.0.1:5432`. Tabel `blogs` memiliki foreign key nullable `user_id` yang merujuk `users.id`. Dua blog lama tetap disimpan tanpa mengarang pemilik: responsnya memiliki `user: null`. Hanya pemilik yang dapat menghapus blog; blog lama tanpa pemilik tidak dapat dihapus melalui API.

User memiliki email unik sebagai `username`, `name` tidak kosong, hash password, serta timestamp otomatis `createdAt` dan `updatedAt`. Nama kolom SQL menggunakan snake_case. Blog juga memiliki timestamp otomatis `createdAt` dan `updatedAt`, serta `year` opsional (null bila tidak diketahui). Bila diberikan, year wajib integer antara 1991 dan tahun saat ini. Validasi berlaku pada API/model dan CHECK constraint PostgreSQL.

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
| GET | `/api/users/:id` | User berdasarkan ID beserta blogs dan readings |
| GET | `/api/users/:id?read=true` | Hanya readings yang sudah dibaca (`false` untuk belum dibaca) |
| PUT | `/api/users/:username` | Ubah **name**; parameter adalah email/username, bukan ID |
| POST | `/api/login` | Verifikasi password dan status user; simpan session, kembalikan JWT |
| DELETE | `/api/logout` | Wajib token aktif; cabut **semua** session user tersebut |
| POST | `/api/readinglists` | Tambah blogId + userId ke reading list; default unread |
| PUT | `/api/readinglists/:id` | Ubah read (boolean); hanya pemilik dengan session aktif |
| GET | `/api/authors` | Statistik jumlah blog dan total likes per author |
| POST | `/api/reset` | **Hanya TESTING=true**, kosongkan blogs, users, reading_lists, sessions pada database tes; 204 |

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

Password minimal 8 karakter, maksimal 1024 byte; hash menggunakan `scrypt` dengan salt acak. Password dan hash tidak muncul pada respons. Token HS256 berlaku satu jam dan membutuhkan `SECRET` acak minimal 32 karakter pada mode normal. Setiap token juga harus cocok dengan session aktif di database dan user tidak boleh disabled. Database hanya menyimpan SHA-256 token, bukan JWT mentah. Logout mencabut semua session user; token yang sudah dicabut tidak dapat dipakai ulang.

**Batas cakupan:** sesuai latihan, PUT likes dan PUT name belum memerlukan autentikasi. Pembaruan user mengubah name, bukan email/username. Endpoint registrasi, GET users, dan POST reading list bisa diakses tanpa login sesuai kontrak latihan. PUT reading list memerlukan session pemilik (bukan pemilik mendapat 401). Batasi akses jaringan; jangan menganggap ini sistem akun production lengkap.

## Reading list

Tambahkan sebuah blog menggunakan ID yang benar-benar ada:

```bash
curl -X POST http://127.0.0.1:3001/api/readinglists \
  -H 'Content-Type: application/json' -d '{"blogId":5,"userId":3}'

curl http://127.0.0.1:3001/api/users/3
curl 'http://127.0.0.1:3001/api/users/3?read=false'

# Gunakan id readingList dari respons user, bukan id blog.
curl -X PUT http://127.0.0.1:3001/api/readinglists/2 \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" -d '{"read":true}'
```

Join table `reading_lists` memiliki pasangan user/blog yang unik. Referensi invalid ditolak; ID valid yang tidak ditemukan mengembalikan 404. POST mengabaikan read dari klien dan selalu membuat entri unread. Setiap item `readings` berisi `readingList: { "id": 2, "read": false }`. Filter read tidak menghapus informasi blog yang ditulis sendiri.

## Migrations dan penonaktifan akun

Empat migration independen dari model berada di `migrations/`, berurutan: schema users/blogs dengan timestamps, year dan constraint, reading lists, lalu disabled/sessions. Umzug menyimpan nama migration yang telah dijalankan pada tabel `migrations` dan tidak mengulangnya saat restart.

```bash
npm run migration:up
# Hanya pada database disposable/setelah backup: membatalkan migration terakhir.
npm run migration:down
```

Rollback dapat menghapus tabel/data. Jangan jalankan pada server aktif atau database penting tanpa backup. Untuk mengganti schema lama Chapter 3, hentikan server, buat `pg_dump`, hapus tabel lama yang sudah dicadangkan, jalankan migrations, lalu pulihkan hanya data dengan daftar kolom eksplisit. Migration awal sengaja menolak tabel users/blogs lama agar tidak diam-diam menandai schema yang salah sebagai selesai. Jangan mengimpor schema lama di atas schema migration baru.

Nonaktifkan/aktifkan user langsung melalui `npm run db:psql`, mengganti email contoh:

```sql
UPDATE users SET disabled = true WHERE username = 'reader@example.com';
UPDATE users SET disabled = false WHERE username = 'reader@example.com';
```

Trigger database mencabut semua session ketika disabled diubah menjadi true, termasuk perubahan melalui psql. Setiap endpoint yang memerlukan login juga memeriksa status session dan user. Mengaktifkan kembali user **tidak** menghidupkan token lama; user harus login ulang. Logout:

```bash
curl -i -X DELETE http://127.0.0.1:3001/api/logout -H "Authorization: Bearer $TOKEN"
```

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

**Database tes bersifat disposable. Reset dan tes integrasi menghapus semua baris blogs, users, reading_lists, dan sessions di database tes. Tabel metadata migrations tetap disimpan. Jangan memakai database berisi data penting.** Tidak ada reset sequence, sehingga token lama tidak bisa cocok dengan ID user baru setelah reset.

### Semua tes Chapter 3–4

Terminal pertama:

```bash
npm run start:test
```

Terminal kedua:

```bash
npm test
```

Tes resmi memanggil `http://localhost:3001`. Jangan jalankan server normal di **alamat localhost dan port yang sama** pada saat bersamaan; server normal yang bind hanya ke IP Tailscale dapat tetap berjalan.

`tests/api_ch3.test.js`, `tests/api_ch4.test.js`, dan `tests/helper.js` disalin tanpa perubahan dari `fullstack-hy2020/tests`, direktori `fs-psql`, commit `e5600257de16a90365465e4e50944241c94e0d6a`. `npm test` menjalankan semuanya secara berurutan dengan `TESTING=true node --test --test-concurrency=1`, termasuk tes resmi kedua chapter dan tes tambahan. Jangan menjalankan beberapa runner bersamaan terhadap database tes yang sama.

### Tes tambahan

Tes tambahan juga dapat dipanggil terpisah (jangan bersamaan dengan runner lain):

```bash
npm run test:config
npm run test:integration
npm run test:migrations
npm audit
```

Tes integrasi membuka HTTP server sendiri pada port acak. Cakupan: validasi blog/user, email unik, timestamp, password, JWT, kepemilikan, pencarian, urutan likes, agregasi author, constraint PostgreSQL, CLI, dan reset. Tes konfigurasi tidak memerlukan koneksi database. Tes migrations membuat database baru dengan nama acak berakhiran `_test`, menguji startup, constraint, rollback dan rerun, lalu menghapus **hanya database sementara itu**. Akun PostgreSQL tes memerlukan izin CREATEDB (service Docker/CI sudah memilikinya).

### CI

`.github/workflows/test.yml` diadaptasi dari workflow upstream. Pada push ke `main`/`master` atau pull request ke branch tersebut, GitHub Actions menyiapkan PostgreSQL 17 dengan database tes, menginstal dependency dari lockfile, menyalakan `start:test` pada schema baru lewat migrations, lalu menjalankan seluruh tes melalui `npm test`. Workflow juga bisa dijalankan manual. Password CI hanya kredensial fixture untuk service sementara, bukan database server.

## Database hosted

Ganti `DATABASE_URL`, set `DATABASE_SSL=true`, dan gunakan `DATABASE_CA_CERT` bila penyedia memberi CA certificate. Verifikasi TLS tetap aktif. Hindari parameter SSL yang bertentangan di URL. Docker lokal menggunakan `DATABASE_SSL=false`.

## Struktur

```text
index.js                 Koneksi database dan lifecycle server
app.js                   Router dan middleware Express
models/index.js          Asosiasi user/blog/reading list/session
models/blog.js           Blog, year, timestamp
models/user.js           Email unik, hash password, disabled, timestamp
models/reading_list.js   Join table reading lists
models/session.js        Model Session untuk sesi aktif
migrations/              Schema versioned dengan up/down
controllers/blogs.js     CRUD blog, pencarian, urutan likes
controllers/users.js     Create/list/detail/update name
controllers/login.js     Login JWT + session database
controllers/logout.js    Pencabutan semua session user
controllers/readinglists.js  Tambah dan update status bacaan
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
