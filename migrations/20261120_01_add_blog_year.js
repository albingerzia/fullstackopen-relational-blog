const { DataTypes } = require('sequelize')

module.exports = {
  up: async ({ context: queryInterface }) => {
    await queryInterface.sequelize.transaction(async transaction => {
      await queryInterface.addColumn('blogs', 'year', { type: DataTypes.INTEGER, allowNull: true }, { transaction })
      await queryInterface.sequelize.query(
        'ALTER TABLE blogs ADD CONSTRAINT blogs_year_range CHECK (year >= 1991 AND year <= EXTRACT(YEAR FROM CURRENT_DATE))',
        { transaction }
      )
    })
  },
  down: async ({ context: queryInterface }) => {
    await queryInterface.sequelize.transaction(async transaction => {
      await queryInterface.removeConstraint('blogs', 'blogs_year_range', { transaction })
      await queryInterface.removeColumn('blogs', 'year', { transaction })
    })
  }
}
