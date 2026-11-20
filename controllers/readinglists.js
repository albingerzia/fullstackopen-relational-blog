const router = require('express').Router()
const { User, Blog, ReadingList } = require('../models')
const { tokenExtractor } = require('../util/middleware')
const { HttpError } = require('../util/errors')
const { jsonObject, primaryKey } = require('../util/validation')

const referenceId = (value, field) => {
  if (!Number.isInteger(value) || value <= 0 || value > 2147483647) {
    throw new HttpError(400, `${field} must be a positive 32-bit integer.`)
  }
  return value
}

router.post('/', async (req, res) => {
  const body = jsonObject(req.body)
  const userId = referenceId(body.userId, 'userId')
  const blogId = referenceId(body.blogId, 'blogId')
  if (!await User.findByPk(userId)) throw new HttpError(404, 'User not found.')
  if (!await Blog.findByPk(blogId)) throw new HttpError(404, 'Blog not found.')
  const entry = await ReadingList.create({ userId, blogId, read: false })
  res.status(201).json(entry)
})

router.put('/:id', tokenExtractor, async (req, res) => {
  const { read } = jsonObject(req.body)
  if (typeof read !== 'boolean') throw new HttpError(400, 'read must be a boolean.')
  const entry = await ReadingList.findByPk(primaryKey(req.params.id))
  if (!entry) throw new HttpError(404, 'Reading list entry not found.')
  if (entry.userId !== req.user.id) throw new HttpError(401, 'Only the owner may change this reading list entry.')
  entry.read = read
  await entry.save()
  res.json(entry)
})

module.exports = router
