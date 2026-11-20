const router = require('express').Router()
const { User, Blog } = require('../models')
const { HttpError } = require('../util/errors')
const { hashPassword } = require('../util/password')
const { jsonObject, nonEmptyString, primaryKey } = require('../util/validation')

const blogInclude = { model: Blog, as: 'blogs', attributes: { exclude: ['userId'] } }

router.get('/', async (_req, res) => {
  const users = await User.findAll({ include: blogInclude, order: [['id', 'ASC'], ['blogs', 'id', 'ASC']] })
  res.json(users)
})

router.post('/', async (req, res) => {
  const { username, name, password } = jsonObject(req.body)
  nonEmptyString(username, 'username', 255)
  nonEmptyString(name, 'name', 255)
  const user = User.build({ username, name, passwordHash: 'pending' })
  await user.validate()
  user.passwordHash = await hashPassword(password)
  await user.save()
  res.status(201).json(user)
})

router.put('/:username', async (req, res) => {
  const { name } = jsonObject(req.body)
  nonEmptyString(name, 'name', 255)
  const user = await User.findOne({ where: { username: req.params.username } })
  if (!user) throw new HttpError(404, 'User not found.')
  user.name = name
  await user.save()
  res.json(user)
})

router.get('/:id', async (req, res) => {
  const user = await User.findByPk(primaryKey(req.params.id), { include: blogInclude })
  if (!user) throw new HttpError(404, 'User not found.')
  res.json(user)
})

module.exports = router
