const jwt = require('jsonwebtoken')
const { ValidationError, UniqueConstraintError, ForeignKeyConstraintError } = require('sequelize')
const { User } = require('../models')
const { SECRET } = require('./config')
const { HttpError } = require('./errors')

const tokenExtractor = async (req, _res, next) => {
  const authorization = req.get('authorization') || ''
  const match = /^Bearer\s+(\S+)$/i.exec(authorization)
  if (!match) throw new HttpError(401, 'token missing')
  const decoded = jwt.verify(match[1], SECRET, { algorithms: ['HS256'] })
  if (!decoded || !Number.isInteger(decoded.id) || decoded.id <= 0 || decoded.id > 2147483647) {
    throw new HttpError(401, 'token invalid')
  }
  req.user = await User.findByPk(decoded.id)
  if (!req.user) throw new HttpError(401, 'token user no longer exists')
  next()
}

const unknownEndpoint = (_req, res) => {
  res.status(404).json({ error: ['Unknown endpoint.'] })
}

// Express 5 forwards synchronous throws and rejected async handlers here.
const errorHandler = (error, _req, res, _next) => {
  if (error instanceof UniqueConstraintError) {
    const messages = error.errors.map(item => item.path === 'username' ? 'username must be unique' : item.message)
    return res.status(400).json({ error: messages })
  }
  if (error instanceof ValidationError) {
    return res.status(400).json({ error: error.errors.map(item => item.message) })
  }
  if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.NotBeforeError) {
    return res.status(401).json({ error: [error.name === 'TokenExpiredError' ? 'token expired' : 'token invalid'] })
  }
  if (error instanceof ForeignKeyConstraintError) {
    return res.status(400).json({ error: ['Referenced user or blog does not exist.'] })
  }
  if (error instanceof HttpError) {
    return res.status(error.status).json({ error: [error.message] })
  }
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: ['Malformed JSON.'] })
  }
  if (error.status >= 400 && error.status < 500) {
    return res.status(error.status).json({ error: ['Invalid request body.'] })
  }
  // Never return SQL, connection strings, hashes, or internal error details.
  console.error('Request failed:', error.name)
  return res.status(500).json({ error: ['Internal server error.'] })
}

module.exports = { tokenExtractor, unknownEndpoint, errorHandler }
