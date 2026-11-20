const { Sequelize } = require('sequelize')
const { DATABASE_URL, TESTING, ssl } = require('./config')

const sequelize = new Sequelize(DATABASE_URL, {
  dialect: 'postgres',
  dialectOptions: { ssl },
  logging: TESTING ? false : console.log
})

const connectToDatabase = async () => {
  await sequelize.authenticate()
  // Load associations before syncing, after confirming database connectivity.
  const { syncModels } = require('../models')
  await syncModels()
}

module.exports = { sequelize, connectToDatabase }
