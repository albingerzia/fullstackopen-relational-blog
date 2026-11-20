const { Model, DataTypes } = require('sequelize')
const { sequelize } = require('../util/db')

class Blog extends Model {}

Blog.init({
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  author: {
    type: DataTypes.TEXT
  },
  url: {
    type: DataTypes.TEXT,
    allowNull: false,
    validate: { notEmpty: true }
  },
  title: {
    type: DataTypes.TEXT,
    allowNull: false,
    validate: { notEmpty: true }
  },
  likes: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    validate: { isInt: true }
  },
  year: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: null,
    validate: {
      validYear(value) {
        if (value !== null && value !== undefined && (!Number.isInteger(value) || value < 1991 || value > new Date().getUTCFullYear())) {
          throw new Error(`year must be an integer between 1991 and ${new Date().getUTCFullYear()}`)
        }
      }
    }
  }
}, {
  sequelize,
  modelName: 'blog',
  tableName: 'blogs',
  underscored: true,
  timestamps: true
})

module.exports = Blog
