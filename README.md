# Full Stack Open — Relational Databases

A blog backend built with PostgreSQL, Sequelize, and Express for Chapters 2–4 (exercises 1–27). Requires Node.js 22+ and Docker with Compose.

## Getting started

From the repository root:

```bash
npm ci
cp .env.example .env
openssl rand -hex 24
openssl rand -hex 32
```

Use the first generated value as `POSTGRES_PASSWORD` and as the password in both `DATABASE_URL` and `TEST_DATABASE_URL`. Use the second value as `SECRET` for signing JWTs. Never commit `.env` or real credentials to Git.

```bash
npm run db:up
npm run migration:up
npm run db:seed
node cli.js
npm start
```

The default API address is `http://127.0.0.1:3001`. `npm run dev` uses Node.js's built-in watch mode. The application authenticates the database connection, applies pending migrations through Umzug, and then starts the HTTP server. It does not synchronize model schemas. Run migrations **before** seeding; `commands.sql` is retained as the historical Chapter 2 SQL file, not as a replacement for migrations.

PostgreSQL data is stored in a named volume. `npm run db:down` does not delete the volume. **`docker compose down -v` deletes the database data.** The database password is set when the volume is first initialized; editing `.env` alone does not change an existing database password.

## Database and CLI

`commands.sql` creates the original Chapter 2 table (`id`, `author`, `url`, `title`, `likes`) and inserts two sample blogs. Running the script again sequentially does not duplicate those sample entries.

```bash
npm run db:psql
```

Inside the psql console:

```sql
\conninfo
\d blogs
\d users
SELECT id, author, title, likes, user_id FROM blogs ORDER BY id;
\q
```

The database listens only on `127.0.0.1:5432`. The `blogs` table has a nullable `user_id` foreign key referencing `users.id`. The two legacy blogs are preserved without assigning an invented owner: their responses contain `user: null`. Only a blog's owner can delete it; legacy blogs without an owner cannot be deleted through the API.

Users have a unique email address as `username`, a non-empty `name`, a password hash, and automatic `createdAt` and `updatedAt` timestamps. SQL column names use snake_case. Blogs also have automatic `createdAt` and `updatedAt` timestamps, along with an optional `year` (null when unknown). When supplied, the year must be an integer between 1991 and the current year. This is enforced by API/model validation and a PostgreSQL CHECK constraint.

```bash
node cli.js
```

Example output, excluding SQL logs:

```text
Dan Abramov: 'On let vs const', 0 likes
Martin Fowler: 'Two Hard Things', 0 likes
```

The CLI closes the database connection when it finishes and returns a nonzero exit code on failure.

## Endpoints

| Method | Endpoint | Behavior |
| --- | --- | --- |
| GET | `/` | 200, `{ "status": "ok" }` |
| GET | `/api/blogs` | All blogs with their creators, ordered by likes descending |
| GET | `/api/blogs?search=react` | Case-insensitive substring search in title **or** author |
| GET | `/api/blogs/:id` | A single blog with its creator |
| POST | `/api/blogs` | Create a blog owned by the user identified by the Bearer token; 201 |
| PUT | `/api/blogs/:id` | Update **only** likes; 200 |
| DELETE | `/api/blogs/:id` | Requires the creator's Bearer token; 204 |
| POST | `/api/users` | Register a user with username/email, name, and password; 201 |
| GET | `/api/users` | All users with the blogs they have created |
| GET | `/api/users/:id` | A user by ID, including authored blogs and readings |
| GET | `/api/users/:id?read=true` | Only readings marked as read (`false` for unread entries) |
| PUT | `/api/users/:username` | Update **name**; the parameter is the email/username, not the ID |
| POST | `/api/login` | Verify password and account status, store a session, and return a JWT |
| DELETE | `/api/logout` | Requires an active token; revoke **all** sessions for that user |
| POST | `/api/readinglists` | Add blogId + userId to a reading list; unread by default |
| PUT | `/api/readinglists/:id` | Update read (boolean); requires the owner's active session |
| GET | `/api/authors` | Blog counts and total likes grouped by author |
| POST | `/api/reset` | **TESTING=true only**; empty blogs, users, reading_lists, and sessions in the test database; 204 |

`title` and `url` must be non-empty strings. `author` is optional. `likes` defaults to `0` and must be a 32-bit integer when supplied. Clients cannot choose an `id` or forge a `userId`. Search treats `%`, `_`, and backslash as literal substring characters, not SQL wildcards. Without a search query, no extra WHERE filter is added.

`/api/authors` uses SQL `COUNT`, `SUM`, `GROUP BY`, and `ORDER BY`, rather than aggregating data in JavaScript. PostgreSQL returns counts and sums as strings, for example:

```json
[
  { "author": "Example Author", "blogs": "3", "likes": "12" }
]
```

### Register, log in, and create a blog

```bash
curl -X POST http://127.0.0.1:3001/api/users \
  -H 'Content-Type: application/json' \
  -d '{"username":"reader@example.com","name":"Example Reader","password":"choose-a-long-password"}'

curl -X POST http://127.0.0.1:3001/api/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"reader@example.com","password":"choose-a-long-password"}'
```

Copy the `token` value from the login response into a local shell variable:

```bash
read -r -s -p 'Token: ' TOKEN; printf '\n'

curl -X POST http://127.0.0.1:3001/api/blogs \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"author":"Example Author","title":"Learning PostgreSQL","url":"https://example.com/post"}'

# Replace BLOG_ID with the id from the POST response.
curl -X PUT http://127.0.0.1:3001/api/blogs/BLOG_ID \
  -H 'Content-Type: application/json' -d '{"likes":3}'

curl -i -X DELETE http://127.0.0.1:3001/api/blogs/BLOG_ID \
  -H "Authorization: Bearer $TOKEN"
```

All HTTP errors are handled in `util/middleware.js`. The response format is `{ "error": ["message"] }`: invalid input or a duplicate email returns `400`, invalid tokens or credentials return `401`, deletion by someone other than the owner returns `403`, and missing resources return `404`. SQL details and credentials are never sent to clients.

Passwords must contain at least 8 characters and at most 1024 bytes; hashing uses `scrypt` with a random salt. Neither passwords nor hashes appear in responses. HS256 tokens last one hour and require a random `SECRET` of at least 32 characters in normal mode. Each token must also match an active database session, and its user must not be disabled. The database stores only the token's SHA-256 digest, not the raw JWT. Logging out revokes all sessions for that user; revoked tokens cannot be reused.

**Scope limitations:** as required by the exercises, updating likes and updating a user's name do not require authentication. User updates change the name, not the email/username. Registration, listing users, and adding reading-list entries are also available without login under the exercise contract. Updating a reading-list entry requires its owner's session (non-owners receive 401). Restrict network access; this is not a complete production account system.

## Reading lists

Add a blog using IDs that actually exist:

```bash
curl -X POST http://127.0.0.1:3001/api/readinglists \
  -H 'Content-Type: application/json' -d '{"blogId":5,"userId":3}'

curl http://127.0.0.1:3001/api/users/3
curl 'http://127.0.0.1:3001/api/users/3?read=false'

# Use the readingList id from the user response, not the blog id.
curl -X PUT http://127.0.0.1:3001/api/readinglists/2 \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" -d '{"read":true}'
```

The `reading_lists` join table enforces a unique user/blog pair. Invalid references are rejected; well-formed IDs that do not exist return 404. POST ignores any client-supplied read state and always creates an unread entry. Each item in `readings` contains `readingList: { "id": 2, "read": false }`. Filtering by read status does not remove information about the user's authored blogs.

## Migrations and account disabling

Four migrations, independent of the models, are stored in `migrations/`. In order, they create the users/blogs schema with timestamps, add the year and its constraint, add reading lists, and add disabled status/sessions. Umzug records applied migration names in the `migrations` table and does not repeat them on restart.

```bash
npm run migration:up
# Only on a disposable database or after a backup: undo the latest migration.
npm run migration:down
```

Rollbacks can delete tables and data. Do not run them against a live server or an important database without a backup. To replace the legacy Chapter 3 schema, stop the server, create a `pg_dump` backup, remove the backed-up tables, apply migrations, and restore only the data using explicit column lists. The initial migration deliberately rejects existing legacy users/blogs tables instead of silently marking an incorrect schema as complete. Do not restore the old schema over the new migration-managed schema.

Disable or enable a user directly through `npm run db:psql`, replacing the sample email:

```sql
UPDATE users SET disabled = true WHERE username = 'reader@example.com';
UPDATE users SET disabled = false WHERE username = 'reader@example.com';
```

A database trigger revokes all sessions when disabled is set to true, including changes made through psql. Every endpoint requiring login also checks the session and user status. Re-enabling a user does **not** reactivate old tokens; the user must log in again. To log out:

```bash
curl -i -X DELETE http://127.0.0.1:3001/api/logout -H "Authorization: Bearer $TOKEN"
```

## Tailscale or SSH access

To expose the API to permitted devices in your tailnet, set `HOST` in `.env` to this machine's Tailscale IPv4 address (`tailscale ip -4`), then restart `npm start`. Open `http://TAILSCALE_IP:3001/api/blogs`. There is no need to bind to `0.0.0.0` or expose the port to the internet. PostgreSQL remains on localhost.

When using the default `HOST=127.0.0.1`, open an SSH tunnel from your laptop:

```bash
ssh -L 3001:127.0.0.1:3001 USER@VPS_IP
```

Then open `http://127.0.0.1:3001/api/blogs` on your laptop. For a Part 5 frontend running on a different port, use a development-server proxy for `/api` to keep requests same-origin.

## Testing

Create the test database once (skip this step if it already exists):

```bash
npm run db:test:create
```

Set `TEST_DATABASE_URL` in `.env`, for example to the `blogdb_test` database. With `TESTING=true`, the application uses only that URL and always binds to localhost, even when the normal server uses Tailscale. The database must be named `test_db` or end in `_test`, and must have a different name from the application database. Reset is unavailable on the normal server.

**The test database is disposable. Reset and integration tests delete all rows from blogs, users, reading_lists, and sessions in the test database. Migration metadata is preserved. Never use a database containing important data.** Sequences are not reset, preventing old tokens from matching newly created user IDs after a reset.

### All Chapter 3–4 tests

In the first terminal:

```bash
npm run start:test
```

In the second terminal:

```bash
npm test
```

The official tests call `http://localhost:3001`. Do not run the normal server on **the same localhost address and port** at the same time; a normal server bound only to the Tailscale IP can remain running.

`tests/api_ch3.test.js`, `tests/api_ch4.test.js`, and `tests/helper.js` are copied unchanged from the `fs-psql` directory of `fullstack-hy2020/tests`, commit `e5600257de16a90365465e4e50944241c94e0d6a`. `npm test` runs everything sequentially with `TESTING=true node --test --test-concurrency=1`, including the official tests for both chapters and the additional tests. Do not run multiple test runners against the same test database at once.

### Additional tests

The additional tests can also be run separately (not alongside another test runner):

```bash
npm run test:config
npm run test:integration
npm run test:migrations
npm audit
```

Integration tests start their own HTTP server on a random port. Coverage includes blog/user validation, unique emails, timestamps, passwords, JWTs, ownership, search, likes ordering, author aggregation, PostgreSQL constraints, the CLI, and reset. Configuration tests do not require a database connection. Migration tests create a new database with a random name ending in `_test`, verify startup, constraints, rollback, and reapplication, then delete **only that temporary database**. The PostgreSQL test account needs the CREATEDB privilege (the Docker/CI service already has it).

### CI

`.github/workflows/test.yml` is adapted from the upstream workflow. On pushes to `main`/`master` or pull requests targeting those branches, GitHub Actions provisions PostgreSQL 17 with a test database, installs dependencies from the lockfile, starts `start:test` on a fresh migration-managed schema, and runs the full suite through `npm test`. The workflow can also be triggered manually. The CI password is a fixture credential for the temporary service, not the server's database password.

## Hosted databases

Replace `DATABASE_URL`, set `DATABASE_SSL=true`, and configure `DATABASE_CA_CERT` if the provider supplies a CA certificate. TLS verification remains enabled. Avoid conflicting SSL parameters in the URL. Local Docker uses `DATABASE_SSL=false`.

## Project structure

```text
index.js                    Database connection and server lifecycle
app.js                      Express routers and middleware
models/index.js             User/blog/reading-list/session associations
models/blog.js              Blog, year, and timestamps
models/user.js              Unique email, password hash, disabled status, timestamps
models/reading_list.js      Reading-list join table
models/session.js           Session model for active sessions
migrations/                 Versioned schema changes with up/down operations
controllers/blogs.js        Blog CRUD, search, and likes ordering
controllers/users.js        Create/list/detail/update name
controllers/login.js        JWT login and database sessions
controllers/logout.js       Revoke all sessions for a user
controllers/readinglists.js Add entries and update reading status
controllers/authors.js      SQL statistics grouped by author
controllers/reset.js        Test-database-only reset
util/config.js              Environment, database isolation, and TLS
util/db.js                  Sequelize connection and migration runner
util/middleware.js          Token verification and error handling
util/password.js            Password hashing and verification with scrypt
util/validation.js          Shared request validation
commands.sql                Original schema and two sample blogs
cli.js                      Console blog reader
compose.yaml                PostgreSQL with a persistent volume
tests/                      Official tests and additional integration tests
.github/workflows/          GitHub Actions
```

`package-lock.json` locks dependency versions. The Sequelize `uuid` override uses version `11.1.1`, which supports CommonJS and addresses the advisory affecting older versions.
