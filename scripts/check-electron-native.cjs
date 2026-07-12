const { createRequire } = require('node:module')
const { join } = require('node:path')
const { app } = require('electron')

const requireFromApp = createRequire(join(__dirname, '..', 'packages', 'app', 'package.json'))

app.whenReady().then(() => {
  const Database = requireFromApp('better-sqlite3')
  const db = new Database(':memory:')
  db.prepare('SELECT 1').get()
  db.close()
  console.log('Electron better-sqlite3 smoke passed')
  app.quit()
}).catch((error) => {
  console.error(error)
  app.exit(1)
})
