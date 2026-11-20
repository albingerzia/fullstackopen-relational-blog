const router = require('express').Router()
const { Op } = require('sequelize')
const { Blog, User } = require('../models')
const { tokenExtractor } = require('../util/middleware')
const { HttpError } = require('../util/errors')
const { jsonObject, nonEmptyString, likesValue, primaryKey } = require('../util/validation')

const userInclude = { model: User, as: 'user', attributes: ['id', 'username', 'name'] }

const blogFinder = async (req, _res, next) => {
  req.blog = await Blog.findByPk(primaryKey(req.params.id), { include: userInclude })
  if (!req.blog) throw new HttpError(404, 'Blog not found.')
  next()
}

router.get('/', async (req, res) => {
  const where = {}
  if (req.query.search !== undefined) {
    if (typeof req.query.search !== 'string') throw new HttpError(400, 'search must be a string.')
    if (req.query.search) {
      // Treat % and _ literally rather than as user-controlled SQL wildcards.
      const search = req.query.search.replace(/[\\%_]/g, '\\$&')
      where[Op.or] = [
        { title: { [Op.iLike]: `%${search}%` } },
        { author: { [Op.iLike]: `%${search}%` } }
      ]
    }
  }
  const blogs = await Blog.findAll({
    attributes: { exclude: ['userId'] },
    include: userInclude,
    where,
    order: [['likes', 'DESC NULLS LAST'], ['id', 'ASC']]
  })
  res.json(blogs)
})

router.get('/:id', blogFinder, (req, res) => res.json(req.blog))

router.post('/', tokenExtractor, async (req, res) => {
  const { author, title, url, likes } = jsonObject(req.body)
  nonEmptyString(title, 'title')
  nonEmptyString(url, 'url')
  if (author !== undefined && author !== null && typeof author !== 'string') {
    throw new HttpError(400, 'author must be a string or null.')
  }
  if (likes !== undefined) likesValue(likes)
  const blog = await Blog.create({
    author,
    title,
    url,
    likes: likes === undefined ? 0 : likes,
    userId: req.user.id
  })
  await blog.reload({ include: userInclude })
  res.status(201).json(blog)
})

router.put('/:id', blogFinder, async (req, res) => {
  const { likes } = jsonObject(req.body)
  req.blog.likes = likesValue(likes)
  await req.blog.save()
  res.json(req.blog)
})

router.delete('/:id', tokenExtractor, blogFinder, async (req, res) => {
  if (req.blog.userId !== req.user.id) {
    throw new HttpError(403, 'Only the user who added this blog may delete it.')
  }
  await req.blog.destroy()
  res.status(204).end()
})

module.exports = router
