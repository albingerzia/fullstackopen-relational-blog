const path = require('node:path')
const assert = require('node:assert/strict')
const { test, before, beforeEach, after } = require('node:test')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true })

// Never clear data in the application database. Tests need an explicitly
// configured, separate database whose name ends in _test.
if (!process.env.TEST_DATABASE_URL) {
  throw new Error('Set TEST_DATABASE_URL to a separate PostgreSQL database ending in _test.')
}
const testUrl = new URL(process.env.TEST_DATABASE_URL)
if (!/^postgres(ql)?:$/.test(testUrl.protocol) || !decodeURIComponent(testUrl.pathname).endsWith('_test')) {
  throw new Error('TEST_DATABASE_URL must point to a PostgreSQL database ending in _test.')
}
if (process.env.DATABASE_URL) {
  const appUrl = new URL(process.env.DATABASE_URL)
  if (testUrl.hostname === appUrl.hostname
      && (testUrl.port || '5432') === (appUrl.port || '5432')
      && testUrl.pathname === appUrl.pathname) {
    throw new Error('TEST_DATABASE_URL must not point to the application database.')
  }
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
process.env.NODE_ENV = 'test'

const app = require('../app')
const Blog = require('../models/blog')
const { sequelize, connectToDatabase } = require('../util/db')
const runFile = promisify(execFile)

let server
let baseUrl
const sample = {
  author: 'Test Author',
  title: 'Learning PostgreSQL',
  url: 'https://example.com/blog'
}

before(async () => {
  await connectToDatabase()
  await new Promise((resolve, reject) => {
    server = app.listen(0, '127.0.0.1', resolve)
    server.once('error', reject)
  })
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

beforeEach(async () => {
  await Blog.destroy({ where: {} })
})

after(async () => {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
    })
  }
  await sequelize.close()
})

const postBlog = body => fetch(`${baseUrl}/api/blogs`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
})

test('GET /api/blogs returns an empty JSON array initially', async () => {
  const response = await fetch(`${baseUrl}/api/blogs`)
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type'), /application\/json/)
  assert.deepEqual(await response.json(), [])
})

test('GET /api/blogs returns every stored blog without timestamp columns', async () => {
  await Blog.create(sample)
  await Blog.create({ ...sample, title: 'Another blog', likes: 7 })
  const response = await fetch(`${baseUrl}/api/blogs`)
  const blogs = await response.json()
  assert.equal(response.status, 200)
  assert.equal(blogs.length, 2)
  assert.equal(blogs[0].title, sample.title)
  assert.equal(blogs[1].likes, 7)
  assert.deepEqual(Object.keys(blogs[0]).sort(), ['author', 'id', 'likes', 'title', 'url'])
})

test('POST /api/blogs persists a blog and defaults likes to zero', async () => {
  const response = await postBlog(sample)
  assert.equal(response.status, 201)
  const blog = await response.json()
  assert.equal(blog.likes, 0)
  assert.equal(blog.title, sample.title)
  assert.ok(Number.isInteger(blog.id))
  const stored = await Blog.findByPk(blog.id)
  assert.equal(stored.url, sample.url)
  assert.equal(await Blog.count(), 1)
})

test('POST accepts optional author and supplied integer likes', async () => {
  const response = await postBlog({ title: sample.title, url: sample.url, likes: 12 })
  assert.equal(response.status, 201)
  const blog = await response.json()
  assert.equal(blog.author, null)
  assert.equal(blog.likes, 12)
})

test('POST ignores a client-supplied primary key and unknown fields', async () => {
  const response = await postBlog({ ...sample, id: 2000000000, unexpected: 'ignored' })
  assert.equal(response.status, 201)
  const blog = await response.json()
  assert.notEqual(blog.id, 2000000000)
  assert.equal(blog.unexpected, undefined)
})

for (const field of ['title', 'url']) {
  for (const invalid of [undefined, null, '', '  ', 123, {}, []]) {
    test(`POST rejects invalid ${field}: ${JSON.stringify(invalid)}`, async () => {
      const response = await postBlog({ ...sample, [field]: invalid })
      assert.equal(response.status, 400)
      assert.equal(typeof (await response.json()).error, 'string')
      assert.equal(await Blog.count(), 0)
    })
  }
}

for (const likes of ['2', 1.5, null, true, 2147483648, -2147483649, {}]) {
  test(`POST rejects invalid likes: ${JSON.stringify(likes)}`, async () => {
    const response = await postBlog({ ...sample, likes })
    assert.equal(response.status, 400)
    assert.equal(await Blog.count(), 0)
  })
}

test('POST rejects a non-string author', async () => {
  const response = await postBlog({ ...sample, author: 123 })
  assert.equal(response.status, 400)
  assert.equal(await Blog.count(), 0)
})

test('POST permits an explicitly null author', async () => {
  const response = await postBlog({ ...sample, author: null })
  assert.equal(response.status, 201)
  assert.equal((await response.json()).author, null)
})

test('POST rejects an array request body', async () => {
  assert.equal((await postBlog([sample])).status, 400)
})

test('POST rejects a missing request body', async () => {
  const response = await fetch(`${baseUrl}/api/blogs`, { method: 'POST' })
  assert.equal(response.status, 400)
})

test('malformed JSON returns a JSON error instead of crashing the server', async () => {
  const response = await fetch(`${baseUrl}/api/blogs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{broken'
  })
  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { error: 'Malformed JSON.' })
  assert.equal((await fetch(`${baseUrl}/api/blogs`)).status, 200)
})

test('oversized JSON returns 413', async () => {
  const response = await postBlog({ ...sample, title: 'x'.repeat(110000) })
  assert.equal(response.status, 413)
})

test('DELETE /api/blogs/:id removes a blog and returns 204 without a body', async () => {
  const blog = await Blog.create(sample)
  const response = await fetch(`${baseUrl}/api/blogs/${blog.id}`, { method: 'DELETE' })
  assert.equal(response.status, 204)
  assert.equal(await response.text(), '')
  assert.equal(await Blog.findByPk(blog.id), null)
})

test('deleting an already deleted blog returns 404', async () => {
  const blog = await Blog.create(sample)
  await blog.destroy()
  const response = await fetch(`${baseUrl}/api/blogs/${blog.id}`, { method: 'DELETE' })
  assert.equal(response.status, 404)
  assert.deepEqual(await response.json(), { error: 'Blog not found.' })
})

for (const id of ['abc', '0', '-1', '1.5', '2147483648', '1 OR 1=1']) {
  test(`DELETE rejects invalid id: ${id}`, async () => {
    const blog = await Blog.create(sample)
    const response = await fetch(`${baseUrl}/api/blogs/${encodeURIComponent(id)}`, { method: 'DELETE' })
    assert.equal(response.status, 400)
    assert.ok(await Blog.findByPk(blog.id))
  })
}

test('unknown endpoints return JSON with status 404', async () => {
  const response = await fetch(`${baseUrl}/missing`)
  assert.equal(response.status, 404)
  assert.deepEqual(await response.json(), { error: 'Unknown endpoint.' })
})

test('PostgreSQL itself enforces required title and url', async () => {
  for (const query of [
    'INSERT INTO blogs (url) VALUES (\'https://example.com\')',
    'INSERT INTO blogs (title) VALUES (\'Missing URL\')'
  ]) {
    await assert.rejects(sequelize.query(query), error => error.original?.code === '23502')
  }
})

test('PostgreSQL supplies the default likes value even for raw SQL', async () => {
  const [rows] = await sequelize.query(
    'INSERT INTO blogs (title, url) VALUES ($1, $2) RETURNING *',
    { bind: [sample.title, sample.url] }
  )
  assert.equal(rows[0].likes, 0)
})

test('node cli.js prints every blog in the requested readable format', async () => {
  await Blog.create(sample)
  await Blog.create({ ...sample, author: 'Another Author', title: 'Second post', likes: 5 })
  const { stdout, stderr } = await runFile(process.execPath, [path.join(__dirname, '..', 'cli.js')], {
    env: process.env,
    timeout: 10000
  })
  assert.equal(stderr, '')
  assert.match(stdout, /Test Author: 'Learning PostgreSQL', 0 likes/)
  assert.match(stdout, /Another Author: 'Second post', 5 likes/)
})
