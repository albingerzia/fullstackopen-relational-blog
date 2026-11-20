const path = require('node:path')
const assert = require('node:assert/strict')
const { test, before, beforeEach, after } = require('node:test')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true })

// Config validates the separate test database before opening any connection.
process.env.TESTING = 'true'
const app = require('../app')
const { Blog, User } = require('../models')
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
  await sequelize.query('TRUNCATE TABLE blogs, users')
  owner = await User.create({ username: 'owner@example.com', name: 'Owner', passwordHash })
  token = jwt.sign({ id: owner.id }, SECRET, { expiresIn: '1h' })
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
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
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
  assert.equal(blogs[0].likes, 7)
  assert.equal(blogs[1].title, sample.title)
  assert.deepEqual(Object.keys(blogs[0]).sort(), ['author', 'id', 'likes', 'title', 'url', 'user'])
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
  const otherToken = jwt.sign({ id: other.id }, SECRET)
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
