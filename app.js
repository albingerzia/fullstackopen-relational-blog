const express = require('express')
const { TESTING } = require('./util/config')
const { unknownEndpoint, errorHandler } = require('./util/middleware')

const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '100kb' }))
app.get('/', (_req, res) => res.status(200).json({ status: 'ok' }))
app.use('/api/blogs', require('./controllers/blogs'))
app.use('/api/users', require('./controllers/users'))
app.use('/api/login', require('./controllers/login'))
app.use('/api/authors', require('./controllers/authors'))

if (TESTING) app.use('/api/reset', require('./controllers/reset'))

app.use(unknownEndpoint)
app.use(errorHandler)

module.exports = app
