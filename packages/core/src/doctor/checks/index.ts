import type { Check } from '../types.js'
import { configChecks } from './config.js'
import { dbChecks } from './db.js'
import { envChecks } from './env.js'
import { nativeChecks } from './native.js'
import { versionChecks } from './versions.js'

export const allChecks: Check[] = [
  ...envChecks,
  ...nativeChecks,
  ...versionChecks,
  ...dbChecks,
  ...configChecks,
]
