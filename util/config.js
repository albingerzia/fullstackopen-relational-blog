const path = require('node:path')
const { readFileSync } = require('node:fs')

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true })

const TESTING = process.env.TESTING === 'true'
const DATABASE_URL = TESTING ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL

if (!DATABASE_URL) {
  throw new Error(`${TESTING ? 'TEST_DATABASE_URL' : 'DATABASE_URL'} is required.`)
}

if (TESTING) {
  const testUrl = new URL(DATABASE_URL)
  const testName = decodeURIComponent(testUrl.pathname.slice(1))
  if (!/^postgres(ql)?:$/.test(testUrl.protocol)
      || !/^(test_db|.+_test)$/.test(testName)
      || testUrl.searchParams.has('database')
      || testUrl.searchParams.has('dbname')) {
    throw new Error('Test database must be named test_db or end in _test, without database query overrides.')
  }
  if (process.env.DATABASE_URL) {
    const appName = decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.slice(1))
    if (testName === appName) {
      throw new Error('Test database must have a different name from the application database.')
    }
  }
}

const SECRET = process.env.SECRET
if (!SECRET || (!TESTING && SECRET.length < 32)) {
  throw new Error('Set SECRET to a random value of at least 32 characters (short test keys are allowed only with TESTING=true).')
}

const ssl = process.env.DATABASE_SSL === 'true'
  ? {
      require: true,
      rejectUnauthorized: true,
      ...(process.env.DATABASE_CA_CERT
        ? { ca: readFileSync(process.env.DATABASE_CA_CERT, 'utf8') }
        : {})
    }
  : false

module.exports = {
  DATABASE_URL,
  TESTING,
  SECRET,
  // Official tests use localhost even when the normal API binds to Tailscale.
  HOST: TESTING ? '127.0.0.1' : (process.env.HOST || '127.0.0.1'),
  PORT: Number(process.env.PORT || 3001),
  ssl
}
