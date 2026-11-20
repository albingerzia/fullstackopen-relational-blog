const { DataTypes } = require('sequelize')
const { sequelize } = require('../util/db')
const Blog = require('./blog')
const User = require('./user')

User.hasMany(Blog, { foreignKey: 'userId', as: 'blogs' })
Blog.belongsTo(User, { foreignKey: 'userId', as: 'user' })

const syncModels = async () => {
  await User.sync()
  await Blog.sync()

  // sync() does not add columns to the existing Chapter 2 table. Add only the
  // nullable ownership column, without alter/force or rewriting existing data.
  const queryInterface = sequelize.getQueryInterface()
  const columns = await queryInterface.describeTable('blogs')
  if (!columns.user_id) {
    await queryInterface.addColumn('blogs', 'user_id', {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL'
    })
  }
}

module.exports = { Blog, User, syncModels }
