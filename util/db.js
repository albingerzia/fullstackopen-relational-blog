const path = require('node:path')
const { Sequelize } = require('sequelize')
const { Umzug, SequelizeStorage } = require('umzug')
const { DATABASE_URL, TESTING, ssl } = require('./config')

const sequelize = new Sequelize(DATABASE_URL, {
  dialect: 'postgres',
  dialectOptions: { ssl },
  logging: TESTING ? false : console.log
})

const migrator = new Umzug({
  migrations: {
    glob: path.join(__dirname, '..', 'migrations', '*.js'),
    resolve: ({ name, path: filename, context }) => {
      const migration = require(filename)
      return { name, up: () => migration.up({ context }), down: () => migration.down({ context }) }
    }
  },
  context: sequelize.getQueryInterface(),
  storage: new SequelizeStorage({ sequelize, tableName: 'migrations' }),
  logger: TESTING ? undefined : console
})

const runMigrations = () => migrator.up()
const rollbackMigration = async () => {
  await sequelize.authenticate()
  return migrator.down()
}

const connectToDatabase = async () => {
  await sequelize.authenticate()
  await runMigrations()
}

module.exports = { sequelize, connectToDatabase, runMigrations, rollbackMigration }
