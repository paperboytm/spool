import { lstat, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { getRawHeader } from '@electron/asar'

const appPath = resolve(process.argv.slice(2).find(arg => !arg.startsWith('-')) ?? 'dist/mac-arm64/Spool.app')
const json = process.argv.includes('--json')
const contents = join(appPath, 'Contents')
const resources = join(contents, 'Resources')
const frameworks = join(contents, 'Frameworks')
const asarPath = join(resources, 'app.asar')
const unpackedPath = `${asarPath}.unpacked`

const moduleBytes = new Map()
const { header } = getRawHeader(asarPath)
collectAsarFiles(header.files, '', moduleBytes)

const report = {
  app: appPath,
  totals: {
    app: await sizeOf(appPath),
    frameworks: await sizeOf(frameworks),
    resources: await sizeOf(resources),
    asar: await sizeOf(asarPath),
    asarUnpacked: await sizeOf(unpackedPath),
  },
  largestFrameworks: await largestChildren(frameworks, 10),
  largestResources: await largestChildren(resources, 10),
  largestModules: [...moduleBytes]
    .map(([name, bytes]) => ({ name, bytes }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 20),
}

if (json) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(`Package size report: ${appPath}`)
  printEntries('Totals', Object.entries(report.totals).map(([name, bytes]) => ({ name, bytes })))
  printEntries('Largest frameworks', report.largestFrameworks)
  printEntries('Largest resources', report.largestResources)
  printEntries('Largest packaged modules', report.largestModules)
}

function collectAsarFiles(entries, parent, totals) {
  for (const [name, entry] of Object.entries(entries)) {
    const path = parent ? `${parent}/${name}` : name
    if ('files' in entry) {
      collectAsarFiles(entry.files, path, totals)
      continue
    }
    if (!('size' in entry)) continue
    const moduleName = packageName(path)
    if (moduleName) totals.set(moduleName, (totals.get(moduleName) ?? 0) + entry.size)
  }
}

function packageName(path) {
  const parts = path.split('/')
  const index = parts.indexOf('node_modules')
  if (index < 0 || !parts[index + 1]) return null
  const first = parts[index + 1]
  return first.startsWith('@') && parts[index + 2] ? `${first}/${parts[index + 2]}` : first
}

async function largestChildren(path, limit) {
  const entries = await readdir(path, { withFileTypes: true })
  const sizes = await Promise.all(entries.map(async entry => ({
    name: entry.name,
    bytes: await sizeOf(join(path, entry.name)),
  })))
  return sizes.sort((a, b) => b.bytes - a.bytes).slice(0, limit)
}

async function sizeOf(path, seen = new Set()) {
  const info = await lstat(path)
  if (info.isSymbolicLink()) return 0
  const identity = `${info.dev}:${info.ino}`
  if (seen.has(identity)) return 0
  seen.add(identity)
  if (!info.isDirectory()) return info.size
  const entries = await readdir(path, { withFileTypes: true })
  return (await Promise.all(entries.map(entry => sizeOf(join(path, entry.name), seen)))).reduce((sum, size) => sum + size, 0)
}

function printEntries(title, entries) {
  console.log(`\n${title}`)
  for (const entry of entries) console.log(`${formatBytes(entry.bytes).padStart(10)}  ${entry.name}`)
}

function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}
