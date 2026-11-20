const { HttpError } = require('./errors')

const MAX_INTEGER = 2147483647
const MIN_INTEGER = -2147483648

const jsonObject = body => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'Send a JSON object.')
  }
  return body
}

const nonEmptyString = (value, field, maxLength) => {
  if (typeof value !== 'string' || !value.trim() || (maxLength && value.length > maxLength)) {
    throw new HttpError(400, `${field} must be a non-empty string${maxLength ? ` of at most ${maxLength} characters` : ''}.`)
  }
  return value
}

const likesValue = value => {
  if (!Number.isInteger(value) || value < MIN_INTEGER || value > MAX_INTEGER) {
    throw new HttpError(400, 'likes must be a 32-bit integer.')
  }
  return value
}

const primaryKey = value => {
  if (!/^[1-9]\d*$/.test(value) || Number(value) > MAX_INTEGER) {
    throw new HttpError(400, 'id must be a positive 32-bit integer.')
  }
  return Number(value)
}

module.exports = { jsonObject, nonEmptyString, likesValue, primaryKey }
