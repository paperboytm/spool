const { createRequire } = require('node:module')
const { dirname, join } = require('node:path')
const { app } = require('electron')

const requireFromApp = createRequire(join(__dirname, '..', 'apps', 'app', 'package.json'))

app
  .whenReady()
  .then(() => {
    const Database = requireFromApp('better-sqlite3')
    const packageDir = dirname(requireFromApp.resolve('better-sqlite3/package.json'))
    const nativeBinding = join(
      packageDir,
      'bin',
      `${process.platform}-${process.arch}-${process.versions.modules}`,
      'better-sqlite3.node',
    )
    const db = new Database(':memory:', { nativeBinding })
    db.prepare('SELECT 1').get()
    db.close()
    console.log('Electron better-sqlite3 smoke passed')
    app.quit()
  })
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
