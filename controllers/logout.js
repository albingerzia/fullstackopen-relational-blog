const router = require('express').Router()
const { User, Session } = require('../models')
const { sequelize } = require('../util/db')
const { tokenExtractor } = require('../util/middleware')

router.delete('/', tokenExtractor, async (req, res) => {
  await sequelize.transaction(async transaction => {
    await User.findByPk(req.user.id, { transaction, lock: transaction.LOCK.UPDATE })
    await Session.destroy({ where: { userId: req.user.id }, transaction })
  })
  res.status(204).end()
})

module.exports = router
