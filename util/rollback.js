const { sequelize, rollbackMigration } = require('./db')

const main = async () => {
  try {
    const undone = await rollbackMigration()
    console.log('Rolled back:', undone.map(migration => migration.name))
  } catch (error) {
    console.error('Migration rollback failed:', error.name)
    process.exitCode = 1
  } finally {
    await sequelize.close()
  }
}

main()
