// electron-builder hook: notarize + staple the DMG itself so first-launch
// works fully offline. The .app inside is already notarized + stapled by
// electron-builder's default mac.notarize flow, but the .dmg container is
// not — without this, Gatekeeper has to fetch the ticket from CloudKit on
// the user's first DMG double-click.
//
// Skips gracefully when notarize env isn't set (e.g. local dev/CI without
// secrets) so unsigned builds still complete.
'use strict'

const { execFile } = require('node:child_process')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)

module.exports = async (context) => {
  const { artifactPaths, platformToTargets } = context

  const isMacBuild = [...platformToTargets.keys()].some(
    (p) => p.name === 'mac' || p.nodeName === 'darwin',
  )
  if (!isMacBuild) return

  const dmgs = (artifactPaths || []).filter((p) => p.endsWith('.dmg'))
  if (dmgs.length === 0) return

  const appleId = process.env['APPLE_ID']
  const password = process.env['APPLE_APP_SPECIFIC_PASSWORD']
  const teamId = process.env['APPLE_TEAM_ID']
  if (!appleId || !password || !teamId) {
    console.log('[notarize-dmg] APPLE_* env not set — skipping DMG notarize/staple')
    return
  }

  for (const dmg of dmgs) {
    console.log(`[notarize-dmg] submitting ${dmg}`)
    await execFileAsync('xcrun', [
      'notarytool', 'submit', dmg,
      '--apple-id', appleId,
      '--password', password,
      '--team-id', teamId,
      '--wait',
    ], { maxBuffer: 32 * 1024 * 1024 })

    console.log(`[notarize-dmg] stapling ${dmg}`)
    await execFileAsync('xcrun', ['stapler', 'staple', dmg], {
      maxBuffer: 4 * 1024 * 1024,
    })

    await execFileAsync('xcrun', ['stapler', 'validate', dmg], {
      maxBuffer: 4 * 1024 * 1024,
    })
    console.log(`[notarize-dmg] ${dmg} stapled OK`)
  }
}
