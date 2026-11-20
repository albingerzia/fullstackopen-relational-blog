const { test } = require('node:test')
const assert = require('node:assert/strict')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const path = require('node:path')
const runFile = promisify(execFile)
const configPath = path.join(__dirname, '..', 'util', 'config.js')

const baseEnv = {
  ...process.env,
  TESTING: 'true',
  SECRET: 'ci_test_secret',
  DATABASE_URL: 'postgres://app:placeholder@localhost:5432/blogdb',
  TEST_DATABASE_URL: 'postgres://app:placeholder@localhost:5432/blogdb_test',
  DATABASE_SSL: 'false'
}

const checkConfig = env => runFile(process.execPath, ['-e', `const c = require(${JSON.stringify(configPath)}); console.log(JSON.stringify({ testing: c.TESTING, database: new URL(c.DATABASE_URL).pathname, host: c.HOST }))`], {
  env: { ...baseEnv, ...env }, timeout: 10000
})

for (const name of ['blogdb_test', 'test_db']) {
  test(`test mode allows disposable database ${name} and binds localhost`, async () => {
    const { stdout } = await checkConfig({ TEST_DATABASE_URL: `postgres://a:b@localhost:5432/${name}`, HOST: '100.64.0.1' })
    assert.deepEqual(JSON.parse(stdout), { testing: true, database: `/${name}`, host: '127.0.0.1' })
  })
}

for (const value of ['', 'postgres://a:b@localhost:5432/blogdb', 'postgres://a:b@localhost:5432/production', 'postgres://a:b@localhost:5432/blogdb_test?database=blogdb', 'postgres://a:b@localhost:5432/blogdb_test?dbname=blogdb']) {
  test(`test mode rejects unsafe or missing test URL: ${value.replace(/a:b@/, '')}`, async () => {
    await assert.rejects(checkConfig({ TEST_DATABASE_URL: value }))
  })
}

test('test mode rejects the application database even with a different host alias', async () => {
  await assert.rejects(checkConfig({ DATABASE_URL: 'postgres://a:b@127.0.0.1:5432/blogdb_test' }))
})

test('normal mode uses the application URL and preserves Tailscale binding', async () => {
  const { stdout } = await checkConfig({ TESTING: 'false', SECRET: 's'.repeat(64), HOST: '100.64.0.1' })
  assert.deepEqual(JSON.parse(stdout), { testing: false, database: '/blogdb', host: '100.64.0.1' })
})

test('normal mode rejects a weak JWT signing secret', async () => {
  await assert.rejects(checkConfig({ TESTING: 'false', SECRET: 'weak' }))
})
