const express = require('express')
const { ValidationError } = require('sequelize')
const blogsRouter = require('./controllers/blogs')

const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '100kb' }))
app.use('/api/blogs', blogsRouter)

app.use((_req, res) => {
  res.status(404).json({ error: 'Unknown endpoint.' })
})

// Express 5 forwards rejected async route handlers here automatically.
app.use((error, _req, res, _next) => {
  if (error instanceof ValidationError) {
    return res.status(400).json({ error: error.errors.map(item => item.message).join(', ') })
  }
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Malformed JSON.' })
  }
  if (error.status >= 400 && error.status < 500) {
    return res.status(error.status).json({ error: 'Invalid request body.' })
  }

  // Avoid exposing SQL queries, connection strings, or internal error details.
  console.error('Request failed:', error.name)
  return res.status(500).json({ error: 'Internal server error.' })
})

module.exports = app
