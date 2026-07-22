import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { program } from 'commander'

import { handleDefaultCommand } from './commands/default.js'
import { doctorCommand } from './commands/doctor.js'
import { listCommand } from './commands/list.js'
import { loginCommand } from './commands/login.js'
import { logoutCommand } from './commands/logout.js'
import { pinCommand, unpinCommand, pinnedCommand } from './commands/pin.js'
import { projectsCommand } from './commands/projects.js'
import { resumeCommand } from './commands/resume.js'
import { searchCommand } from './commands/search.js'
import { shareCommand } from './commands/share.js'
import { showCommand } from './commands/show.js'
import { statusCommand } from './commands/status.js'
import { syncCommand } from './commands/sync.js'
import { withdrawCommand } from './commands/withdraw.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as {
  version: string
}

program
  .name('spool')
  .description('Publish, read, resume, and manage agent sessions with Spool')
  .version(pkg.version)
  .action(async () => {
    const exitCode = await handleDefaultCommand()
    if (exitCode !== 0) process.exitCode = exitCode
  })

program.addCommand(searchCommand)
program.addCommand(syncCommand)
program.addCommand(listCommand)
program.addCommand(statusCommand)
program.addCommand(showCommand)
program.addCommand(pinCommand)
program.addCommand(unpinCommand)
program.addCommand(pinnedCommand)
program.addCommand(projectsCommand)
program.addCommand(doctorCommand)
program.addCommand(loginCommand)
program.addCommand(logoutCommand)
program.addCommand(shareCommand)
program.addCommand(resumeCommand)
program.addCommand(withdrawCommand)

await program.parseAsync()
