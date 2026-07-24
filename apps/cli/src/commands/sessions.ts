import { Command } from 'commander'

import { listCommand } from './list.js'
import { searchCommand } from './search.js'
import { showCommand } from './show.js'

// Browse tier: reading and finding local Sessions lives under one group so
// the top-level command list stays the small everyday set (subscribe, daemon,
// share, visibility, withdraw, resume, login, doctor).

export const sessionsCommand = new Command('sessions').description(
  'Browse, search, and read local sessions',
)

sessionsCommand.addCommand(listCommand)
sessionsCommand.addCommand(searchCommand)
sessionsCommand.addCommand(showCommand)
