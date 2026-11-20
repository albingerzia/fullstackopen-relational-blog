const { Sequelize } = require('sequelize')
const { DATABASE_URL, ssl } = require('./config')

const sequelize = new Sequelize(DATABASE_URL, {
  dialect: 'postgres',
  dialectOptions: { ssl },
  logging: process.env.NODE_ENV === 'test' ? false : console.log
})

const connectToDatabase = async () => {
  await sequelize.authenticate()
  // sync() only creates missing tables; never use force/alter on existing data.
  await sequelize.sync()
}

module.exports = { sequelize, connectToDatabase }
