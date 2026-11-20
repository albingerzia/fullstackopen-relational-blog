const { Model, DataTypes } = require('sequelize')
const { sequelize } = require('../util/db')

class User extends Model {
  toJSON() {
    const data = { ...this.get() }
    delete data.passwordHash
    return data
  }
}

User.init({
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  username: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: { name: 'users_username_key', msg: 'username must be unique' },
    validate: {
      notNull: { msg: 'username is required' },
      notEmpty: { msg: 'username must not be empty' },
      isEmail: { msg: 'username must be a valid email address' }
    }
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      notNull: { msg: 'name is required' },
      notEmpty: { msg: 'name must not be empty' }
    }
  },
  passwordHash: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  disabled: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  }
}, {
  sequelize,
  modelName: 'user',
  underscored: true,
  // Keep automatic createdAt and updatedAt; columns use snake_case.
  timestamps: true,
  defaultScope: { attributes: { exclude: ['passwordHash'] } }
})

module.exports = User
