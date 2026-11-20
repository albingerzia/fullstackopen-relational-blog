const router = require('express').Router()
const { TESTING } = require('../util/config')
const { sequelize } = require('../util/db')

if (!TESTING) throw new Error('Reset routes must never load outside test mode.')

router.post('/', async (_req, res) => {
  // Keep migration metadata and sequences, but invalidate all login sessions.
  await sequelize.query('TRUNCATE TABLE sessions, reading_lists, blogs, users')
  res.status(204).end()
})

module.exports = router
