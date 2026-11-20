const app = require('./app')
const { connectToDatabase, sequelize } = require('./util/db')
const { HOST, PORT } = require('./util/config')

const start = async () => {
  await connectToDatabase()

  const server = app.listen(PORT, HOST, () => {
    console.log(`Server running at http://${HOST}:${PORT}`)
  })

  server.on('error', async error => {
    console.error('Unable to start HTTP server:', error.code || error.name)
    await sequelize.close()
    process.exitCode = 1
  })

  let stopping = false
  const stop = () => {
    if (stopping) return
    stopping = true
    const timeout = setTimeout(() => process.exit(1), 10000)
    timeout.unref()
    server.close(async () => {
      try {
        await sequelize.close()
      } catch (error) {
        console.error('Unable to close database connection:', error.name)
        process.exitCode = 1
      } finally {
        clearTimeout(timeout)
      }
    })
  }

  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
}

start().catch(async error => {
  console.error('Unable to start application:', error.name)
  await sequelize.close()
  process.exitCode = 1
})
