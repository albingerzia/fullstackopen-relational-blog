const router = require('express').Router()
const jwt = require('jsonwebtoken')
const { randomUUID } = require('node:crypto')
const { User } = require('../models')
const { SECRET } = require('../util/config')
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
  const token = jwt.sign({ id: user.id, username: user.username }, SECRET, {
    algorithm: 'HS256',
    expiresIn: '1h',
    jwtid: randomUUID()
  })
  res.json({ token, username: user.username, name: user.name })
})

module.exports = router
