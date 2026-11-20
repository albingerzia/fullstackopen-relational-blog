const router = require('express').Router()
const { fn, col, literal } = require('sequelize')
const { Blog } = require('../models')

router.get('/', async (_req, res) => {
  const authors = await Blog.findAll({
    attributes: [
      'author',
      [fn('COUNT', col('id')), 'blogs'],
      [fn('COALESCE', fn('SUM', col('likes')), 0), 'likes']
    ],
    group: ['author'],
    order: [[literal('"likes"'), 'DESC'], ['author', 'ASC NULLS LAST']],
    raw: true
  })
  res.json(authors)
})

module.exports = router
