const { DataTypes, literal } = require('sequelize')

module.exports = {
  up: async ({ context: queryInterface }) => {
    await queryInterface.sequelize.transaction(async transaction => {
      await queryInterface.addColumn('users', 'disabled', {
        type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false
      }, { transaction })
      await queryInterface.createTable('sessions', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
        user_id: {
          type: DataTypes.INTEGER, allowNull: false,
          references: { model: 'users', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE'
        },
        token_hash: { type: DataTypes.STRING(64), allowNull: false, unique: true },
        expires_at: { type: DataTypes.DATE, allowNull: false },
        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') }
      }, { transaction })
      await queryInterface.addIndex('sessions', ['user_id'], { name: 'sessions_user_id_idx', transaction })
      // Revoking sessions in the database keeps old tokens invalid even after
      // re-enabling a user. Also runs on disable operations made through psql.
      await queryInterface.sequelize.query(`
        CREATE FUNCTION revoke_disabled_user_sessions() RETURNS trigger AS $$
        BEGIN
          IF NEW.disabled THEN
            DELETE FROM sessions WHERE user_id = NEW.id;
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER users_revoke_sessions_on_disable
        AFTER UPDATE OF disabled ON users
        FOR EACH ROW EXECUTE FUNCTION revoke_disabled_user_sessions();
      `, { transaction })
    })
  },
  down: async ({ context: queryInterface }) => {
    await queryInterface.sequelize.transaction(async transaction => {
      await queryInterface.sequelize.query(`
        DROP TRIGGER users_revoke_sessions_on_disable ON users;
        DROP FUNCTION revoke_disabled_user_sessions();
      `, { transaction })
      await queryInterface.dropTable('sessions', { transaction })
      await queryInterface.removeColumn('users', 'disabled', { transaction })
    })
  }
}
