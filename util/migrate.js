const { sequelize, connectToDatabase } = require('./db')

const main = async () => {
  try {
    await connectToDatabase()
    console.log('Migrations up to date.')
  } catch (error) {
    console.error('Migration failed:', error.name, error.cause?.message || '')
    process.exitCode = 1
  } finally {
    await sequelize.close()
  }
}

main()
