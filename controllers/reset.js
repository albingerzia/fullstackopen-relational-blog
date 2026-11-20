const router = require('express').Router()
const { TESTING } = require('../util/config')
const { sequelize } = require('../util/db')

if (!TESTING) throw new Error('Reset routes must never load outside test mode.')

router.post('/', async (_req, res) => {
  // Atomically empty both related tables. Do not restart sequences: tokens from
  // before reset must not become valid for a newly created user with a reused ID.
  await sequelize.query('TRUNCATE TABLE blogs, users')
  res.status(204).end()
})

module.exports = router
