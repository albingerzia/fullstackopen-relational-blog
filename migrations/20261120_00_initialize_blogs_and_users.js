const { DataTypes, literal } = require('sequelize')

module.exports = {
  up: async ({ context: queryInterface }) => {
    await queryInterface.sequelize.transaction(async transaction => {
      const tables = await queryInterface.showAllTables({ transaction })
      if (tables.includes('users') || tables.includes('blogs')) {
        throw new Error('Legacy tables found. Back up and rebuild them before running the initial migration.')
      }
      await queryInterface.createTable('users', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
        username: { type: DataTypes.STRING, unique: true, allowNull: false },
        name: { type: DataTypes.STRING, allowNull: false },
        password_hash: { type: DataTypes.TEXT, allowNull: false },
        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
        updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') }
      }, { transaction })
      await queryInterface.createTable('blogs', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
        author: { type: DataTypes.TEXT },
        title: { type: DataTypes.TEXT, allowNull: false },
        url: { type: DataTypes.TEXT, allowNull: false },
        likes: { type: DataTypes.INTEGER, defaultValue: 0 },
        user_id: {
          type: DataTypes.INTEGER,
          allowNull: true,
          references: { model: 'users', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL'
        },
        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
        updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') }
      }, { transaction })
    })
  },
  down: async ({ context: queryInterface }) => {
    await queryInterface.sequelize.transaction(async transaction => {
      await queryInterface.dropTable('blogs', { transaction })
      await queryInterface.dropTable('users', { transaction })
    })
  }
}
