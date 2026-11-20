const path = require('node:path')
const { readFileSync } = require('node:fs')

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true })

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required. Copy .env.example to .env and configure PostgreSQL.')
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
  DATABASE_URL: process.env.DATABASE_URL,
  HOST: process.env.HOST || '127.0.0.1',
  PORT: Number(process.env.PORT || 3001),
  ssl
}
