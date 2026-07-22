import { CLI_INSTALL_DOCS_URL, formatCliCommand } from '../../cli-command.js'
import { probeSqlite } from '../preflight.js'
import type { Check, CheckResult } from '../types.js'

export const nativeChecks: Check[] = [
  {
    id: 'native.sqlite',
    category: 'native',
    title: 'better-sqlite3 native module',
    run: (): CheckResult => {
      const status = probeSqlite()
      if (status.ok) {
        return {
          id: 'native.sqlite',
          category: 'native',
          title: 'better-sqlite3 native module',
          severity: 'ok',
          message: `loaded (Node ${process.version})`,
          details: { node: process.version },
        }
      }
      return {
        id: 'native.sqlite',
        category: 'native',
        title: 'better-sqlite3 native module',
        severity: 'error',
        message: summarizeAbiError(status.error),
        details: { error: status.error.message, node: process.version },
      }
    },
  },
]

function summarizeAbiError(err: Error): string {
  const msg = err.message
  const abiMatch = msg.match(/NODE_MODULE_VERSION (\d+)[\s\S]*?NODE_MODULE_VERSION (\d+)/)
  if (abiMatch) {
    const compiled = abiMatch[1]
    const wanted = abiMatch[2]
    return (
      `Node ABI mismatch (compiled for v${compiled}, this Node wants v${wanted}). ` +
      `Reinstall from ${CLI_INSTALL_DOCS_URL}, then retry with ` +
      `\`${formatCliCommand('doctor')}\`.`
    )
  }
  const oneLine = msg.split('\n')[0] ?? msg
  return `Failed to load: ${oneLine}`
}
