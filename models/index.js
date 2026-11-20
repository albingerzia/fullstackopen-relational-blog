const Blog = require('./blog')
const User = require('./user')
const ReadingList = require('./reading_list')
const Session = require('./session')

User.hasMany(Blog, { foreignKey: 'userId', as: 'blogs' })
Blog.belongsTo(User, { foreignKey: 'userId', as: 'user' })

User.belongsToMany(Blog, { through: ReadingList, as: 'readings', foreignKey: 'userId', otherKey: 'blogId' })
Blog.belongsToMany(User, { through: ReadingList, as: 'readers', foreignKey: 'blogId', otherKey: 'userId' })

User.hasMany(Session, { foreignKey: 'userId', as: 'sessions' })
Session.belongsTo(User, { foreignKey: 'userId', as: 'user' })

module.exports = { Blog, User, ReadingList, Session }
