const path = require('node:path')
const assert = require('node:assert/strict')
const { test, before, beforeEach, after } = require('node:test')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true })

// Config validates the separate test database before opening any connection.
process.env.TESTING = 'true'
const app = require('../app')
const { Blog, User, ReadingList, Session } = require('../models')
const { randomUUID } = require('node:crypto')
const { tokenHash } = require('../util/session')
const { sequelize, connectToDatabase } = require('../util/db')
const { SECRET } = require('../util/config')
const { hashPassword } = require('../util/password')
const jwt = require('jsonwebtoken')
const runFile = promisify(execFile)

let server
let baseUrl
let owner
let token
let passwordHash
const sample = {
  author: 'Test Author',
  title: 'Learning PostgreSQL',
  url: 'https://example.com/blog'
}

before(async () => {
  await connectToDatabase()
  passwordHash = await hashPassword('test-password-123')
  await new Promise((resolve, reject) => {
    server = app.listen(0, '127.0.0.1', resolve)
    server.once('error', reject)
  })
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

beforeEach(async () => {
  await sequelize.query('TRUNCATE TABLE sessions, reading_lists, blogs, users')
  owner = await User.create({ username: 'owner@example.com', name: 'Owner', passwordHash })
  token = await createSession(owner.id)
})

after(async () => {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
    })
  }
  await sequelize.close()
})

const createSession = async userId => {
  const token = jwt.sign({ id: userId }, SECRET, { expiresIn: '1h', jwtid: randomUUID() })
  const { exp } = jwt.decode(token)
  await Session.create({ userId, tokenHash: tokenHash(token), expiresAt: new Date(exp * 1000) })
  return token
}

const postBlog = body => fetch(`${baseUrl}/api/blogs`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify(body)
})

test('GET /api/blogs returns an empty JSON array initially', async () => {
  const response = await fetch(`${baseUrl}/api/blogs`)
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type'), /application\/json/)
  assert.deepEqual(await response.json(), [])
})

test('GET /api/blogs returns every stored blog including year and timestamps', async () => {
  await Blog.create(sample)
  await Blog.create({ ...sample, title: 'Another blog', likes: 7 })
  const response = await fetch(`${baseUrl}/api/blogs`)
  const blogs = await response.json()
  assert.equal(response.status, 200)
  assert.equal(blogs.length, 2)
  assert.equal(blogs[0].likes, 7)
  assert.equal(blogs[1].title, sample.title)
  assert.deepEqual(Object.keys(blogs[0]).sort(), ['author', 'createdAt', 'id', 'likes', 'title', 'updatedAt', 'url', 'user', 'year'])
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
  assert.equal(stored.userId, owner.id)
  assert.equal(blog.user.id, owner.id)
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
      assert.ok(Array.isArray((await response.json()).error))
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
  const response = await fetch(`${baseUrl}/api/blogs`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
  assert.equal(response.status, 400)
})

test('malformed JSON returns a JSON error instead of crashing the server', async () => {
  const response = await fetch(`${baseUrl}/api/blogs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: '{broken'
  })
  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { error: ['Malformed JSON.'] })
  assert.equal((await fetch(`${baseUrl}/api/blogs`)).status, 200)
})

test('oversized JSON returns 413', async () => {
  const response = await postBlog({ ...sample, title: 'x'.repeat(110000) })
  assert.equal(response.status, 413)
})

test('DELETE /api/blogs/:id removes a blog and returns 204 without a body', async () => {
  const blog = await Blog.create({ ...sample, userId: owner.id })
  const response = await fetch(`${baseUrl}/api/blogs/${blog.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
  assert.equal(response.status, 204)
  assert.equal(await response.text(), '')
  assert.equal(await Blog.findByPk(blog.id), null)
})

test('deleting an already deleted blog returns 404', async () => {
  const blog = await Blog.create(sample)
  await blog.destroy()
  const response = await fetch(`${baseUrl}/api/blogs/${blog.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
  assert.equal(response.status, 404)
  assert.deepEqual(await response.json(), { error: ['Blog not found.'] })
})

for (const id of ['abc', '0', '-1', '1.5', '2147483648', '1 OR 1=1']) {
  test(`DELETE rejects invalid id: ${id}`, async () => {
    const blog = await Blog.create(sample)
    const response = await fetch(`${baseUrl}/api/blogs/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
    assert.equal(response.status, 400)
    assert.ok(await Blog.findByPk(blog.id))
  })
}

test('unknown endpoints return JSON with status 404', async () => {
  const response = await fetch(`${baseUrl}/missing`)
  assert.equal(response.status, 404)
  assert.deepEqual(await response.json(), { error: ['Unknown endpoint.'] })
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

const request = (route, { method = 'GET', body, auth } = {}) => fetch(`${baseUrl}${route}`, {
  method,
  headers: {
    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(auth ? { Authorization: `Bearer ${auth}` } : {})
  },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {})
})

const newUser = {
  username: 'new@example.com', name: 'New User', password: 'new-password-123'
}

test('GET / responds with 200', async () => {
  assert.equal((await request('/')).status, 200)
})

test('POST users persists an email username and automatic timestamps but never exposes passwords', async () => {
  const response = await request('/api/users', { method: 'POST', body: { ...newUser, passwordHash: 'injected', id: 2000000000 } })
  assert.equal(response.status, 201)
  const user = await response.json()
  assert.equal(user.username, newUser.username)
  assert.ok(!Number.isNaN(Date.parse(user.createdAt)))
  assert.equal(user.createdAt, user.updatedAt)
  assert.equal(user.passwordHash, undefined)
  assert.equal(user.password, undefined)
  assert.notEqual(user.id, 2000000000)
  const stored = await User.unscoped().findByPk(user.id)
  assert.notEqual(stored.passwordHash, newUser.password)
  assert.notEqual(stored.passwordHash, 'injected')
})

for (const username of ['not-an-email', 'foo@', '@example.com', 'user name@example.com']) {
  test(`POST users rejects invalid email ${username} with descriptive Sequelize errors`, async () => {
    const response = await request('/api/users', { method: 'POST', body: { ...newUser, username } })
    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), { error: ['username must be a valid email address'] })
    assert.equal(await User.count(), 1)
  })
}

for (const body of [
  { ...newUser, name: '' }, { ...newUser, name: '   ' },
  { ...newUser, name: 123 }, { ...newUser, username: '' },
  { ...newUser, password: undefined }, { ...newUser, password: 'short' }
]) {
  test(`POST users rejects invalid user input ${JSON.stringify(body)}`, async () => {
    const response = await request('/api/users', { method: 'POST', body })
    assert.equal(response.status, 400)
    assert.ok(Array.isArray((await response.json()).error))
    assert.equal(await User.count(), 1)
  })
}

test('POST users rejects duplicate email usernames', async () => {
  const response = await request('/api/users', { method: 'POST', body: { ...newUser, username: owner.username } })
  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { error: ['username must be unique'] })
})

test('GET users and user by id include their blogs, never password hashes', async () => {
  const blog = await Blog.create({ ...sample, userId: owner.id })
  for (const route of ['/api/users', `/api/users/${owner.id}`]) {
    const response = await request(route)
    assert.equal(response.status, 200)
    const data = await response.json()
    const user = Array.isArray(data) ? data[0] : data
    assert.equal(user.id, owner.id)
    assert.equal(user.blogs.length, 1)
    assert.equal(user.blogs[0].id, blog.id)
    assert.equal(user.blogs[0].userId, undefined)
    assert.equal(user.passwordHash, undefined)
    assert.ok(user.createdAt)
    assert.ok(user.updatedAt)
  }
})

test('PUT users addresses username, updates only name, and advances updatedAt', async () => {
  await new Promise(resolve => setTimeout(resolve, 15))
  const response = await request(`/api/users/${encodeURIComponent(owner.username)}`, {
    method: 'PUT', body: { name: 'Updated Name', username: 'ignored@example.com', passwordHash: 'injected' }
  })
  assert.equal(response.status, 200)
  const user = await response.json()
  assert.equal(user.username, owner.username)
  assert.equal(user.name, 'Updated Name')
  assert.equal(user.createdAt, owner.createdAt.toISOString())
  assert.ok(Date.parse(user.updatedAt) > owner.updatedAt.getTime())
  assert.equal(user.passwordHash, undefined)
  assert.equal((await User.unscoped().findByPk(owner.id)).passwordHash, passwordHash)
})

test('PUT users rejects blank name and unknown usernames', async () => {
  assert.equal((await request(`/api/users/${owner.username}`, { method: 'PUT', body: { name: '' } })).status, 400)
  assert.equal((await request('/api/users/missing@example.com', { method: 'PUT', body: { name: 'Valid' } })).status, 404)
  assert.equal((await request(`/api/users/${owner.id}`, { method: 'PUT', body: { name: 'Valid' } })).status, 404)
})

test('GET user by id returns 404 for a missing user and 400 for an invalid id', async () => {
  assert.equal((await request('/api/users/2147483647')).status, 404)
  assert.equal((await request('/api/users/invalid')).status, 400)
})

test('login verifies the stored password and issues a signed, expiring token', async () => {
  const response = await request('/api/login', { method: 'POST', body: { username: owner.username, password: 'test-password-123' } })
  assert.equal(response.status, 200)
  const data = await response.json()
  assert.equal(data.username, owner.username)
  assert.equal(data.name, owner.name)
  const decoded = jwt.verify(data.token, SECRET)
  assert.equal(decoded.id, owner.id)
  assert.equal(decoded.exp - decoded.iat, 3600)
  assert.ok(decoded.jti)
  assert.equal(data.passwordHash, undefined)
  assert.equal((await request('/api/blogs', { method: 'POST', body: sample, auth: data.token })).status, 201)
})

for (const credentials of [
  { username: 'owner@example.com', password: 'wrong-password' },
  { username: 'unknown@example.com', password: 'test-password-123' }
]) {
  test(`login rejects wrong credentials for ${credentials.username}`, async () => {
    const response = await request('/api/login', { method: 'POST', body: credentials })
    assert.equal(response.status, 401)
    assert.deepEqual(await response.json(), { error: ['invalid username or password'] })
  })
}

test('POST blogs requires a token and rejects malformed, expired, or unsupported tokens', async () => {
  const tokens = [
    undefined,
    'not-a-token',
    jwt.sign({ id: owner.id }, SECRET, { expiresIn: -1 }),
    jwt.sign({ id: owner.id }, 'different-key'),
    jwt.sign({ id: owner.id }, SECRET, { algorithm: 'HS384' }),
    jwt.sign({ id: String(owner.id) }, SECRET),
    jwt.sign({ id: 2147483647 }, SECRET)
  ]
  for (const auth of tokens) {
    const response = await request('/api/blogs', { method: 'POST', body: sample, auth })
    assert.equal(response.status, 401)
  }
  assert.equal(await Blog.count(), 0)
})

test('POST blogs ignores forged ownership and GET blogs joins the actual creator', async () => {
  const response = await request('/api/blogs', { method: 'POST', body: { ...sample, userId: 2147483647 }, auth: token })
  assert.equal(response.status, 201)
  const blog = await response.json()
  assert.equal((await Blog.findByPk(blog.id)).userId, owner.id)
  const blogs = await (await request('/api/blogs')).json()
  assert.deepEqual(blogs[0].user, { id: owner.id, username: owner.username, name: owner.name })
  assert.equal(blogs[0].userId, undefined)
})

test('PUT blogs modifies likes only and does not require login', async () => {
  const blog = await Blog.create({ ...sample, userId: owner.id })
  const response = await request(`/api/blogs/${blog.id}`, {
    method: 'PUT', body: { likes: 3, title: 'ignored', userId: 2147483647 }
  })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).likes, 3)
  await blog.reload()
  assert.equal(blog.title, sample.title)
  assert.equal(blog.userId, owner.id)
  assert.equal(blog.likes, 3)
})

for (const likes of [undefined, '3', null, 1.5, 2147483648]) {
  test(`PUT blogs rejects invalid likes ${JSON.stringify(likes)} through central errors`, async () => {
    const blog = await Blog.create(sample)
    const response = await request(`/api/blogs/${blog.id}`, { method: 'PUT', body: { likes } })
    assert.equal(response.status, 400)
    assert.ok(Array.isArray((await response.json()).error))
    assert.equal((await blog.reload()).likes, 0)
  })
}

test('PUT blogs returns 404 for missing blogs and 400 for malformed ids', async () => {
  assert.equal((await request('/api/blogs/2147483647', { method: 'PUT', body: { likes: 3 } })).status, 404)
  assert.equal((await request('/api/blogs/invalid', { method: 'PUT', body: { likes: 3 } })).status, 400)
})

test('DELETE blogs requires authentication and forbids other users from deleting', async () => {
  const blog = await Blog.create({ ...sample, userId: owner.id })
  assert.equal((await request(`/api/blogs/${blog.id}`, { method: 'DELETE' })).status, 401)
  const other = await User.create({ username: 'other@example.com', name: 'Other', passwordHash })
  const otherToken = await createSession(other.id)
  assert.equal((await request(`/api/blogs/${blog.id}`, { method: 'DELETE', auth: otherToken })).status, 403)
  assert.ok(await Blog.findByPk(blog.id))
})

test('legacy blogs without an owner remain visible but cannot be claimed for deletion', async () => {
  const blog = await Blog.create(sample)
  assert.equal((await (await request('/api/blogs')).json())[0].user, null)
  assert.equal((await request(`/api/blogs/${blog.id}`, { method: 'DELETE', auth: token })).status, 403)
})

test('search matches title or author case-insensitively and sorts by likes descending', async () => {
  await Blog.bulkCreate([
    { ...sample, title: 'React patterns', author: 'Someone', likes: 2 },
    { ...sample, title: 'Other title', author: 'REACT Expert', likes: 8 },
    { ...sample, title: 'Unrelated', author: null, likes: 10 }
  ])
  const matches = await (await request('/api/blogs?search=rEaCt')).json()
  assert.equal(matches.length, 2)
  assert.deepEqual(matches.map(blog => blog.likes), [8, 2])
  const all = await (await request('/api/blogs')).json()
  assert.deepEqual(all.map(blog => blog.likes), [10, 8, 2])
  assert.equal((await (await request('/api/blogs?search=')).json()).length, 3)
  assert.deepEqual(await (await request('/api/blogs?search=absent')).json(), [])
})

for (const term of ['%', '_', '\\', "' OR 1=1 --"]) {
  test(`search treats ${JSON.stringify(term)} as a literal substring`, async () => {
    await Blog.create({ ...sample, title: `Contains ${term} here` })
    await Blog.create({ ...sample, title: 'Unrelated title' })
    const response = await request(`/api/blogs?search=${encodeURIComponent(term)}`)
    assert.equal(response.status, 200)
    const data = await response.json()
    assert.equal(data.length, 1)
    assert.equal(data[0].title, `Contains ${term} here`)
  })
}

test('search rejects duplicate or non-string query parameters', async () => {
  assert.equal((await request('/api/blogs?search=one&search=two')).status, 400)
})

test('author statistics aggregate counts and likes in SQL, ordered numerically by total likes', async () => {
  await Blog.bulkCreate([
    { ...sample, author: 'First', likes: 8 },
    { ...sample, author: 'First', likes: 4 },
    { ...sample, author: 'Second', likes: 9 },
    { ...sample, author: 'Null likes', likes: null }
  ])
  const response = await request('/api/authors')
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), [
    { author: 'First', blogs: '2', likes: '12' },
    { author: 'Second', blogs: '1', likes: '9' },
    { author: 'Null likes', blogs: '1', likes: '0' }
  ])
})

test('reset empties both test tables without reusing token identity', async () => {
  await Blog.create({ ...sample, userId: owner.id })
  assert.equal((await request('/api/reset', { method: 'POST' })).status, 204)
  assert.equal(await Blog.count(), 0)
  assert.equal(await User.count(), 0)
  const replacement = await User.create({ username: owner.username, name: 'Replacement', passwordHash })
  assert.notEqual(replacement.id, owner.id)
  assert.equal((await request('/api/blogs', { method: 'POST', body: sample, auth: token })).status, 401)
})

for (const year of [1990, new Date().getUTCFullYear() + 1, 2001.5, '2001', true, {}]) {
  test(`POST blogs rejects invalid year ${JSON.stringify(year)}`, async () => {
    const response = await postBlog({ ...sample, year })
    assert.equal(response.status, 400)
    assert.match((await response.json()).error[0], /year must be an integer between 1991 and/)
    assert.equal(await Blog.count(), 0)
  })
}

for (const year of [1991, new Date().getUTCFullYear(), null]) {
  test(`POST blogs accepts year ${year}`, async () => {
    const response = await postBlog({ ...sample, year })
    assert.equal(response.status, 201)
    const blog = await response.json()
    assert.equal(blog.year, year)
    assert.ok(blog.createdAt)
    assert.equal(blog.createdAt, blog.updatedAt)
  })
}

test('blog updatedAt advances while createdAt remains unchanged', async () => {
  const blog = await Blog.create(sample)
  await new Promise(resolve => setTimeout(resolve, 15))
  const response = await request(`/api/blogs/${blog.id}`, { method: 'PUT', body: { likes: 9 } })
  const data = await response.json()
  assert.equal(data.createdAt, blog.createdAt.toISOString())
  assert.ok(Date.parse(data.updatedAt) > blog.updatedAt.getTime())
})

test('reading list defaults to unread and ignores client supplied state and id', async () => {
  const blog = await Blog.create(sample)
  const response = await request('/api/readinglists', { method: 'POST', body: { userId: owner.id, blogId: blog.id, read: true, id: 2000000000 } })
  assert.equal(response.status, 201)
  const entry = await response.json()
  assert.equal(entry.read, false)
  assert.notEqual(entry.id, 2000000000)
  assert.equal(entry.userId, owner.id)
  assert.equal(entry.blogId, blog.id)
  const user = await (await request(`/api/users/${owner.id}`)).json()
  assert.deepEqual(user.readings[0].readingList, { id: entry.id, read: false })
  assert.equal(user.readings[0].id, blog.id)
  assert.equal(user.readings[0].userId, undefined)
})

for (const field of ['userId', 'blogId']) {
  for (const value of [undefined, null, '1', 0, -1, 1.5, 2147483648]) {
    test(`reading lists reject invalid ${field} ${JSON.stringify(value)}`, async () => {
      const blog = await Blog.create(sample)
      const response = await request('/api/readinglists', { method: 'POST', body: { userId: owner.id, blogId: blog.id, [field]: value } })
      assert.equal(response.status, 400)
      assert.match((await response.json()).error[0], new RegExp(field))
      assert.equal(await ReadingList.count(), 0)
    })
  }
}

test('reading lists return 404 for missing references and 400 for duplicates', async () => {
  const blog = await Blog.create(sample)
  for (const body of [{ userId: 2147483647, blogId: blog.id }, { userId: owner.id, blogId: 2147483647 }]) {
    assert.equal((await request('/api/readinglists', { method: 'POST', body })).status, 404)
  }
  const body = { userId: owner.id, blogId: blog.id }
  const results = await Promise.all([1, 2].map(() => request('/api/readinglists', { method: 'POST', body })))
  assert.deepEqual(results.map(response => response.status).sort(), [201, 400])
  assert.equal(await ReadingList.count(), 1)
})

test('reading list state is editable only by its owner with a live session', async () => {
  const blog = await Blog.create(sample)
  const entry = await ReadingList.create({ userId: owner.id, blogId: blog.id })
  const other = await User.create({ username: 'other@example.com', name: 'Other', passwordHash })
  const otherToken = await createSession(other.id)
  assert.equal((await request(`/api/readinglists/${entry.id}`, { method: 'PUT', body: { read: true } })).status, 401)
  assert.equal((await request(`/api/readinglists/${entry.id}`, { method: 'PUT', body: { read: true }, auth: otherToken })).status, 401)
  for (const read of [true, false]) {
    const response = await request(`/api/readinglists/${entry.id}`, { method: 'PUT', body: { read, userId: other.id }, auth: token })
    assert.equal(response.status, 200)
    const data = await response.json()
    assert.equal(data.read, read)
    assert.equal(data.userId, owner.id)
  }
})

test('reading list updates validate boolean state and IDs', async () => {
  const blog = await Blog.create(sample)
  const entry = await ReadingList.create({ userId: owner.id, blogId: blog.id })
  for (const read of [undefined, 'true', 1, null]) {
    assert.equal((await request(`/api/readinglists/${entry.id}`, { method: 'PUT', body: { read }, auth: token })).status, 400)
  }
  assert.equal((await request('/api/readinglists/2147483647', { method: 'PUT', body: { read: true }, auth: token })).status, 404)
  assert.equal((await request('/api/readinglists/invalid', { method: 'PUT', body: { read: true }, auth: token })).status, 400)
})

test('read filtering affects readings only, not authored blogs or user existence', async () => {
  const [unread, read] = await Blog.bulkCreate([{ ...sample, userId: owner.id }, { ...sample, title: 'Read post' }])
  await ReadingList.bulkCreate([{ userId: owner.id, blogId: unread.id }, { userId: owner.id, blogId: read.id, read: true }])
  const all = await (await request(`/api/users/${owner.id}`)).json()
  assert.equal(all.readings.length, 2)
  for (const state of [true, false]) {
    const user = await (await request(`/api/users/${owner.id}?read=${state}`)).json()
    assert.equal(user.readings.length, 1)
    assert.equal(user.readings[0].readingList.read, state)
    assert.equal(user.blogs.length, 1)
  }
  await ReadingList.destroy({ where: {} })
  const empty = await request(`/api/users/${owner.id}?read=true`)
  assert.equal(empty.status, 200)
  assert.deepEqual((await empty.json()).readings, [])
  assert.equal((await request(`/api/users/${owner.id}?read=invalid`)).status, 400)
  assert.equal((await request(`/api/users/${owner.id}?read=true&read=false`)).status, 400)
})

test('deleting a blog cascades its reading list entries', async () => {
  const blog = await Blog.create({ ...sample, userId: owner.id })
  await ReadingList.create({ userId: owner.id, blogId: blog.id })
  assert.equal((await request(`/api/blogs/${blog.id}`, { method: 'DELETE', auth: token })).status, 204)
  assert.equal(await ReadingList.count(), 0)
})

test('login stores only a token digest and supports multiple independent sessions', async () => {
  const tokens = []
  for (let i = 0; i < 2; i++) {
    const response = await request('/api/login', { method: 'POST', body: { username: owner.username, password: 'test-password-123' } })
    assert.equal(response.status, 200)
    const { token: value } = await response.json()
    tokens.push(value)
    const session = await Session.findOne({ where: { tokenHash: tokenHash(value) } })
    assert.ok(session)
    assert.equal(session.userId, owner.id)
    assert.equal(session.expiresAt.getTime(), jwt.decode(value).exp * 1000)
    assert.ok(!JSON.stringify(session).includes(value))
    assert.equal((await request('/api/blogs', { method: 'POST', body: sample, auth: value })).status, 201)
  }
  assert.notEqual(tokens[0], tokens[1])
})

test('logout revokes every session of that user but not another user', async () => {
  const second = await createSession(owner.id)
  const other = await User.create({ username: 'other@example.com', name: 'Other', passwordHash })
  const otherToken = await createSession(other.id)
  assert.equal((await request('/api/logout', { method: 'DELETE', auth: token })).status, 204)
  for (const auth of [token, second]) {
    assert.equal((await request('/api/blogs', { method: 'POST', body: sample, auth })).status, 401)
  }
  assert.equal(await Session.count({ where: { userId: owner.id } }), 0)
  assert.equal((await request('/api/blogs', { method: 'POST', body: sample, auth: otherToken })).status, 201)
  assert.equal((await request('/api/logout', { method: 'DELETE', auth: token })).status, 401)
  assert.equal((await request('/api/logout', { method: 'DELETE' })).status, 401)
})

test('a correctly signed token without an active session cannot authenticate', async () => {
  const forged = jwt.sign({ id: owner.id }, SECRET, { expiresIn: '1h', jwtid: randomUUID() })
  assert.equal((await request('/api/blogs', { method: 'POST', body: sample, auth: forged })).status, 401)
  await Session.update({ expiresAt: new Date(0) }, { where: { userId: owner.id } })
  assert.equal((await request('/api/blogs', { method: 'POST', body: sample, auth: token })).status, 401)
})

test('database disabling revokes sessions immediately and old tokens stay invalid after re-enabling', async () => {
  const blog = await Blog.create({ ...sample, userId: owner.id })
  const entry = await ReadingList.create({ userId: owner.id, blogId: blog.id })
  await sequelize.query('UPDATE users SET disabled=true WHERE id=$1', { bind: [owner.id] })
  assert.equal(await Session.count({ where: { userId: owner.id } }), 0)
  assert.equal((await request('/api/login', { method: 'POST', body: { username: owner.username, password: 'test-password-123' } })).status, 401)
  for (const [route, method, body] of [
    ['/api/blogs', 'POST', sample], [`/api/blogs/${blog.id}`, 'DELETE'],
    [`/api/readinglists/${entry.id}`, 'PUT', { read: true }], ['/api/logout', 'DELETE']
  ]) {
    assert.equal((await request(route, { method, body, auth: token })).status, 401)
  }
  await sequelize.query('UPDATE users SET disabled=false WHERE id=$1', { bind: [owner.id] })
  assert.equal((await request('/api/blogs', { method: 'POST', body: sample, auth: token })).status, 401)
  const login = await request('/api/login', { method: 'POST', body: { username: owner.username, password: 'test-password-123' } })
  const active = (await login.json()).token
  assert.equal(login.status, 200)
  assert.equal((await request('/api/blogs', { method: 'POST', body: sample, auth: active })).status, 201)
})

test('disabling and re-enabling without intervening requests still revokes the old token', async () => {
  await sequelize.query('UPDATE users SET disabled=true WHERE id=$1', { bind: [owner.id] })
  await sequelize.query('UPDATE users SET disabled=false WHERE id=$1', { bind: [owner.id] })
  assert.equal((await request('/api/blogs', { method: 'POST', body: sample, auth: token })).status, 401)
})

test('registration and name updates cannot set disabled status', async () => {
  const response = await request('/api/users', { method: 'POST', body: { ...newUser, disabled: true } })
  assert.equal(response.status, 201)
  assert.equal((await response.json()).disabled, false)
  await User.update({ disabled: true }, { where: { id: owner.id } })
  await request(`/api/users/${owner.username}`, { method: 'PUT', body: { name: 'Changed', disabled: false } })
  assert.equal((await owner.reload()).disabled, true)
})

test('reset removes reading lists and sessions but preserves migration metadata', async () => {
  const blog = await Blog.create(sample)
  await ReadingList.create({ userId: owner.id, blogId: blog.id })
  const [before] = await sequelize.query('SELECT name FROM migrations ORDER BY name')
  assert.equal((await request('/api/reset', { method: 'POST' })).status, 204)
  for (const model of [Blog, User, ReadingList, Session]) assert.equal(await model.count(), 0)
  const [after] = await sequelize.query('SELECT name FROM migrations ORDER BY name')
  assert.deepEqual(after, before)
})
