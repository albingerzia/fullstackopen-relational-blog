-- Exercise 2: run in psql, for example with `npm run db:seed`.
-- CREATE IF NOT EXISTS and WHERE NOT EXISTS make this script safe to rerun.
BEGIN;

CREATE TABLE IF NOT EXISTS blogs (
    id SERIAL PRIMARY KEY,
    author TEXT,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    likes INTEGER DEFAULT 0
);

INSERT INTO blogs (author, url, title)
SELECT 'Dan Abramov', 'https://overreacted.io/on-let-vs-const/', 'On let vs const'
WHERE NOT EXISTS (
    SELECT 1 FROM blogs WHERE url = 'https://overreacted.io/on-let-vs-const/'
);

INSERT INTO blogs (author, url, title)
SELECT 'Martin Fowler', 'https://martinfowler.com/bliki/TwoHardThings.html', 'Two Hard Things'
WHERE NOT EXISTS (
    SELECT 1 FROM blogs WHERE url = 'https://martinfowler.com/bliki/TwoHardThings.html'
);

COMMIT;
