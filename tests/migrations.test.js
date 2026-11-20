const { test } = require('node:test')
const assert = require('node:assert/strict')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { randomBytes } = require('node:crypto')
const path = require('node:path')
const { Client } = require('pg')

const root = path.join(__dirname, '..')
require('dotenv').config({ path: path.join(root, '.env'), quiet: true })
const { ssl } = require('../util/config')
const runFile = promisify(execFile)

test('migrations initialize an empty database, enforce constraints, and roll back cleanly', async () => {
  const adminUrl = new URL(process.env.TEST_DATABASE_URL)
  const name = `migration_${randomBytes(6).toString('hex')}_test`
  const dbUrl = new URL(adminUrl)
  dbUrl.pathname = `/${name}`
  const admin = new Client({ connectionString: adminUrl.toString(), ssl })
  let client
  await admin.connect()
  const env = { ...process.env, TESTING: 'true', DATABASE_URL: '', TEST_DATABASE_URL: dbUrl.toString(), SECRET: 'migration-test-secret' }
  const run = code => runFile(process.execPath, ['-e', code], { cwd: root, env, timeout: 30000 })
  try {
    await admin.query(`CREATE DATABASE "${name}"`)
    client = new Client({ connectionString: dbUrl.toString(), ssl })
    await client.connect()
    await run('const db=require("./util/db"); db.connectToDatabase().finally(()=>db.sequelize.close())')
    const before = (await client.query('SELECT name FROM migrations ORDER BY name')).rows
    assert.equal(before.length, 4)
    await run('const db=require("./util/db"); db.connectToDatabase().finally(()=>db.sequelize.close())')
    assert.deepEqual((await client.query('SELECT name FROM migrations ORDER BY name')).rows, before)
    for (const table of ['blogs', 'users']) {
      const columns = (await client.query('SELECT column_name FROM information_schema.columns WHERE table_name=$1', [table])).rows.map(row => row.column_name)
      assert.ok(columns.includes('created_at'))
      assert.ok(columns.includes('updated_at'))
    }
    const user = (await client.query("INSERT INTO users(username,name,password_hash) VALUES('migration@example.com','Migration','test-hash') RETURNING *")).rows[0]
    assert.equal(user.disabled, false)
    assert.ok(user.created_at)
    const blog = (await client.query("INSERT INTO blogs(title,url) VALUES('Migration','https://example.com') RETURNING *")).rows[0]
    assert.equal(blog.year, null)
    assert.ok(blog.created_at)
    assert.equal(blog.likes, 0)
    for (const year of [1991, new Date().getUTCFullYear()]) {
      await client.query('UPDATE blogs SET year=$1 WHERE id=$2', [year, blog.id])
    }
    for (const year of [1990, new Date().getUTCFullYear() + 1]) {
      await assert.rejects(client.query('UPDATE blogs SET year=$1 WHERE id=$2', [year, blog.id]), error => error.code === '23514')
    }
    await assert.rejects(client.query("UPDATE blogs SET year='1.5' WHERE id=$1", [blog.id]), error => error.code === '22P02')
    const entry = (await client.query('INSERT INTO reading_lists(user_id,blog_id) VALUES($1,$2) RETURNING *', [user.id, blog.id])).rows[0]
    assert.equal(entry.read, false)
    await assert.rejects(client.query('INSERT INTO reading_lists(user_id,blog_id) VALUES($1,$2)', [user.id, blog.id]), error => error.code === '23505')
    await assert.rejects(client.query('INSERT INTO reading_lists(user_id,blog_id) VALUES($1,2147483647)', [user.id]), error => error.code === '23503')
    await client.query('INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,NOW()+INTERVAL \'1 hour\')', [user.id, 'a'.repeat(64)])
    await client.query('UPDATE users SET disabled=true WHERE id=$1', [user.id])
    assert.equal((await client.query('SELECT count(*) FROM sessions')).rows[0].count, '0')
    const rollback = await run('const db=require("./util/db"); db.rollbackMigration().then(x=>console.log(JSON.stringify(x))).finally(()=>db.sequelize.close())')
    assert.equal((await client.query('SELECT count(*) FROM migrations')).rows[0].count, '3')
    const sessionTables = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name='sessions'")
    assert.equal(sessionTables.rows.length, 0, rollback.stdout)
    await run('const db=require("./util/db"); db.runMigrations().finally(()=>db.sequelize.close())')
    assert.equal((await client.query('SELECT count(*) FROM migrations')).rows[0].count, '4')
    await run('const db=require("./util/db"); (async()=>{try{for(let i=0;i<4;i++) await db.rollbackMigration()}finally{await db.sequelize.close()}})()')
    assert.equal((await client.query("SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('users','blogs','reading_lists','sessions')")).rows[0].count, '0')
    await run('const db=require("./util/db"); db.connectToDatabase().finally(()=>db.sequelize.close())')
    assert.equal((await client.query('SELECT count(*) FROM migrations')).rows[0].count, '4')
  } finally {
    if (client) await client.end()
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
    await admin.end()
  }
})
