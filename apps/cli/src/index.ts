import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { program } from 'commander'

import { daemonCommand } from './commands/daemon.js'
import { handleDefaultCommand } from './commands/default.js'
import { doctorCommand } from './commands/doctor.js'
import { loginCommand } from './commands/login.js'
import { logoutCommand } from './commands/logout.js'
import { projectsCommand } from './commands/projects.js'
import { resumeCommand } from './commands/resume.js'
import { sessionsCommand } from './commands/sessions.js'
import { shareCommand } from './commands/share.js'
import { subscribeCommand, subscriptionsCommand, unsubscribeCommand } from './commands/subscribe.js'
import { teamsCommand } from './commands/teams.js'
import { visibilityCommand } from './commands/visibility.js'
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

// The everyday set stays small: configure trust once (login, subscribe),
// bind local work to Teams and Projects, keep the daemon running, and handle
// exceptions explicitly (share, visibility, withdraw, resume). Browsing lives
// under `spool sessions`.
program.addCommand(subscribeCommand)
program.addCommand(unsubscribeCommand)
program.addCommand(subscriptionsCommand)
program.addCommand(teamsCommand)
program.addCommand(projectsCommand)
program.addCommand(daemonCommand)
program.addCommand(shareCommand)
program.addCommand(visibilityCommand)
program.addCommand(withdrawCommand)
program.addCommand(resumeCommand)
program.addCommand(sessionsCommand)
program.addCommand(doctorCommand)
program.addCommand(loginCommand)
program.addCommand(logoutCommand)

await program.parseAsync()
