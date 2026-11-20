const { randomBytes, scrypt: scryptCallback, timingSafeEqual } = require('node:crypto')
const { promisify } = require('node:util')
const { HttpError } = require('./errors')

const scrypt = promisify(scryptCallback)
const options = { N: 16384, r: 8, p: 1 }

const hashPassword = async password => {
  if (typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password) > 1024) {
    throw new HttpError(400, 'password must contain at least 8 characters and at most 1024 bytes.')
  }
  const salt = randomBytes(16).toString('hex')
  const hash = await scrypt(password, salt, 64, options)
  return `${salt}:${hash.toString('hex')}`
}

const checkPassword = async (password, passwordHash) => {
  if (typeof password !== 'string' || Buffer.byteLength(password) > 1024 || !passwordHash) return false
  const [salt, stored] = passwordHash.split(':')
  if (!salt || !stored) return false
  const expected = Buffer.from(stored, 'hex')
  const actual = await scrypt(password, salt, 64, options)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

module.exports = { hashPassword, checkPassword }
