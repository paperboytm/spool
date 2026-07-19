import { cacheCurrentNativeBuild } from './better-sqlite3-native.mjs'

const modules = process.argv[2]
if (!modules || !/^\d+$/.test(modules)) {
  console.error('Usage: cache-better-sqlite3-native.mjs <NODE_MODULE_VERSION>')
  process.exit(2)
}

const destination = cacheCurrentNativeBuild({ modules })
console.log(`[cache-better-sqlite3-native] cached ${destination}`)
