const jwt = require('jsonwebtoken')
const { ValidationError, UniqueConstraintError, ForeignKeyConstraintError } = require('sequelize')
const { Op } = require('sequelize')
const { User, Session } = require('../models')
const { tokenHash } = require('./session')
const { SECRET } = require('./config')
const { HttpError } = require('./errors')

const tokenExtractor = async (req, _res, next) => {
  const authorization = req.get('authorization') || ''
  const match = /^Bearer\s+(\S+)$/i.exec(authorization)
  if (!match) throw new HttpError(401, 'token missing')
  const decoded = jwt.verify(match[1], SECRET, { algorithms: ['HS256'] })
  if (!decoded || !Number.isInteger(decoded.id) || decoded.id <= 0 || decoded.id > 2147483647
      || !Number.isInteger(decoded.exp) || typeof decoded.jti !== 'string') {
    throw new HttpError(401, 'token invalid')
  }
  req.session = await Session.findOne({
    where: { tokenHash: tokenHash(match[1]), userId: decoded.id, expiresAt: { [Op.gt]: new Date() } },
    include: { model: User, as: 'user' }
  })
  if (!req.session || !req.session.user) throw new HttpError(401, 'session expired or revoked')
  req.user = req.session.user
  if (req.user.disabled) throw new HttpError(401, 'account disabled, please contact admin')
  next()
}

const unknownEndpoint = (_req, res) => {
  res.status(404).json({ error: ['Unknown endpoint.'] })
}

// Express 5 forwards synchronous throws and rejected async handlers here.
const errorHandler = (error, _req, res, _next) => {
  if (error instanceof UniqueConstraintError) {
    const messages = error.errors.map(item => item.path === 'username' ? 'username must be unique' : item.message)
    if (error.original?.constraint === 'reading_lists_user_blog_unique') {
      return res.status(400).json({ error: ['This blog is already in the user\'s reading list.'] })
    }
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
  if (error.original?.constraint === 'blogs_year_range') {
    return res.status(400).json({ error: [`year must be an integer between 1991 and ${new Date().getUTCFullYear()}`] })
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
