const router = require('express').Router()
const Blog = require('../models/blog')

const MAX_INTEGER = 2147483647
const MIN_INTEGER = -2147483648

router.get('/', async (_req, res) => {
  const blogs = await Blog.findAll({ order: [['id', 'ASC']] })
  res.json(blogs)
})

router.post('/', async (req, res) => {
  const body = req.body
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ error: 'Send a JSON object containing title and url.' })
  }

  const { author, title, url, likes } = body
  if (typeof title !== 'string' || !title.trim() || typeof url !== 'string' || !url.trim()) {
    return res.status(400).json({ error: 'title and url must be non-empty strings.' })
  }
  if (author !== undefined && author !== null && typeof author !== 'string') {
    return res.status(400).json({ error: 'author must be a string or null.' })
  }
  if (likes !== undefined && (!Number.isInteger(likes) || likes < MIN_INTEGER || likes > MAX_INTEGER)) {
    return res.status(400).json({ error: 'likes must be a 32-bit integer.' })
  }

  // Explicitly select editable fields; clients cannot set the primary key.
  const blog = await Blog.create({ author, title, url, likes: likes === undefined ? 0 : likes })
  return res.status(201).json(blog)
})

router.delete('/:id', async (req, res) => {
  const { id } = req.params
  if (!/^[1-9]\d*$/.test(id) || Number(id) > MAX_INTEGER) {
    return res.status(400).json({ error: 'id must be a positive 32-bit integer.' })
  }

  const deleted = await Blog.destroy({ where: { id: Number(id) } })
  if (deleted === 0) {
    return res.status(404).json({ error: 'Blog not found.' })
  }
  return res.status(204).end()
})

module.exports = router
