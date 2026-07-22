import { loadHubCredentials } from '../hub/credentials.js'
import { createClackUi, type CliUi } from '../ui.js'
import { handleLoginCommand } from './login.js'
import { handleShareCommand } from './share.js'
import { syncLocalSessions } from './sync.js'

export interface DefaultCommandDependencies {
  ui?: CliUi
  sync?: () => 0 | 1 | Promise<0 | 1>
  isLoggedIn?: () => boolean
  login?: () => Promise<0 | 1>
  share?: () => Promise<0 | 1>
}

/** `spool` is the everyday path: refresh the local index, establish the
 * one-time Hub credential when needed, then share the latest Session for cwd. */
export async function handleDefaultCommand(
  dependencies: DefaultCommandDependencies = {},
): Promise<0 | 1> {
  const ui = dependencies.ui ?? createClackUi()
  const sync = dependencies.sync ?? (() => (syncLocalSessions(ui) === null ? 1 : 0))
  if ((await sync()) !== 0) return 1

  const isLoggedIn = dependencies.isLoggedIn ?? (() => Boolean(loadHubCredentials().token?.trim()))
  let loggedIn: boolean
  try {
    loggedIn = isLoggedIn()
  } catch (cause) {
    ui.error(cause instanceof Error ? cause.message : String(cause))
    return 1
  }
  if (!loggedIn) {
    ui.info('Sign in once to publish this Session.')
    const login = dependencies.login ?? (() => handleLoginCommand({}, { ui }))
    if ((await login()) !== 0) return 1
  }

  const share =
    dependencies.share ?? (() => handleShareCommand(undefined, { agentSummary: true }, { ui }))
  return share()
}
