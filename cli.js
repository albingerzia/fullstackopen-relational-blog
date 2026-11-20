const { QueryTypes } = require('sequelize')
const { sequelize } = require('./util/db')

const main = async () => {
  try {
    await sequelize.authenticate()
    const blogs = await sequelize.query('SELECT * FROM blogs ORDER BY id', {
      type: QueryTypes.SELECT
    })
    for (const blog of blogs) {
      console.log(`${blog.author ?? 'Unknown author'}: '${blog.title}', ${blog.likes} likes`)
    }
  } catch (error) {
    console.error('Unable to read blogs:', error.name)
    process.exitCode = 1
  } finally {
    await sequelize.close()
  }
}

main()
