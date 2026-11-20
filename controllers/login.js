const router = require('express').Router()
const jwt = require('jsonwebtoken')
const { randomUUID } = require('node:crypto')
const { User, Session } = require('../models')
const { sequelize } = require('../util/db')
const { SECRET } = require('../util/config')
const { tokenHash } = require('../util/session')
const { HttpError } = require('../util/errors')
const { checkPassword } = require('../util/password')
const { jsonObject, nonEmptyString } = require('../util/validation')

router.post('/', async (req, res) => {
  const { username, password } = jsonObject(req.body)
  nonEmptyString(username, 'username', 255)
  nonEmptyString(password, 'password')
  const user = await User.unscoped().findOne({ where: { username } })
  if (!user || !await checkPassword(password, user.passwordHash)) {
    throw new HttpError(401, 'invalid username or password')
  }
  const data = await sequelize.transaction(async transaction => {
    // Serialize login with psql disable operations and logout for this user.
    const current = await User.findByPk(user.id, { transaction, lock: transaction.LOCK.UPDATE })
    if (!current || current.disabled) throw new HttpError(401, 'account disabled, please contact admin')
    const token = jwt.sign({ id: current.id, username: current.username }, SECRET, {
      algorithm: 'HS256', expiresIn: '1h', jwtid: randomUUID()
    })
    const { exp } = jwt.decode(token)
    await Session.create({ userId: current.id, tokenHash: tokenHash(token), expiresAt: new Date(exp * 1000) }, { transaction })
    return { token, username: current.username, name: current.name }
  })
  res.json(data)
})

module.exports = router
