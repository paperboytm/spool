import { reportAutoPublish, runAutoPublish } from '../hub/auto-publish.js'
import { loadHubCredentials } from '../hub/credentials.js'
import { sessionMatchesSubscription } from '../hub/subscription-match.js'
import { loadSubscriptions, type Subscription } from '../subscriptions.js'
import { createClackUi, type CliUi } from '../ui.js'
import { handleLoginCommand } from './login.js'
import { handleShareCommand } from './share.js'
import { subscriptionLabel } from './subscribe.js'
import { syncLocalSessions } from './sync.js'

export interface DefaultCommandDependencies {
  ui?: CliUi
  cwd?: string
  sync?: () => 0 | 1 | Promise<0 | 1>
  isLoggedIn?: () => boolean
  login?: () => Promise<0 | 1>
  share?: () => Promise<0 | 1>
  /** The subscription covering cwd, if any; injected in tests. */
  findSubscription?: (cwd: string) => Subscription | null
  /** One auto-publish pass; injected in tests. */
  autoPublish?: (ui: CliUi) => Promise<0 | 1>
}

/** `spool` is the everyday path. In a subscribed directory it reports the
 * continuous-publishing state and runs one catch-up pass; elsewhere it
 * refreshes the index, establishes the one-time Hub credential when needed,
 * then shares the latest Session for cwd. */
export async function handleDefaultCommand(
  dependencies: DefaultCommandDependencies = {},
): Promise<0 | 1> {
  const ui = dependencies.ui ?? createClackUi()
  const cwd = dependencies.cwd ?? process.cwd()
  const sync = dependencies.sync ?? (() => (syncLocalSessions(ui) === null ? 1 : 0))
  if ((await sync()) !== 0) return 1

  const findSubscription = dependencies.findSubscription ?? defaultFindSubscription
  let subscription: Subscription | null = null
  try {
    subscription = findSubscription(cwd)
  } catch {
    // A corrupt subscriptions file must not block the manual share path.
  }
  if (subscription) {
    ui.info(
      `This directory is subscribed (${subscriptionLabel(subscription)}); sessions publish automatically.`,
    )
    const autoPublish = dependencies.autoPublish ?? defaultAutoPublish
    const exitCode = await autoPublish(ui)
    if (exitCode === 0) ui.outro('Subscribed sessions are up to date.')
    return exitCode
  }

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

function defaultFindSubscription(cwd: string): Subscription | null {
  return (
    loadSubscriptions().find((subscription) =>
      sessionMatchesSubscription(cwd, subscription.path),
    ) ?? null
  )
}

async function defaultAutoPublish(ui: CliUi): Promise<0 | 1> {
  try {
    reportAutoPublish(ui, await runAutoPublish(ui))
    return 0
  } catch (cause) {
    ui.error(cause instanceof Error ? cause.message : String(cause))
    return 1
  }
}
