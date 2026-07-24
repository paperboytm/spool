import { formatCliCommand } from '@spool-lab/core'
import { Command } from 'commander'

import type { HubCredentialOptions } from '../hub/credentials.js'
import {
  addSubscription,
  canonicalSubscriptionPath,
  loadSubscriptions,
  removeSubscription,
  type Subscription,
} from '../subscriptions.js'
import { createClackUi, createTextUi, type CliUi } from '../ui.js'

// `spool subscribe [dir]` records the one-time decision that Sessions from a
// directory — and from its git worktrees — publish automatically on every
// sync. All later syncing is prompt-free; `spool sync --watch` keeps the hub
// continuously up to date.

export interface SubscribeCommandOptions {
  linkOnly?: boolean
  yes?: boolean
}

export interface SubscribeCommandDependencies extends HubCredentialOptions {
  ui?: CliUi
  cwd?: string
  now?: () => string
}

export async function handleSubscribeCommand(
  directory: string | undefined,
  options: SubscribeCommandOptions,
  dependencies: SubscribeCommandDependencies = {},
): Promise<0 | 1> {
  const ui = dependencies.ui ?? createTextUi()
  const cwd = dependencies.cwd ?? process.cwd()
  ui.intro('Subscribe a directory')
  try {
    const path = canonicalSubscriptionPath(directory ?? cwd, cwd)
    const visibility = options.linkOnly === true ? 'link-only' : 'provider-default'

    // The whole point of a subscription is that this is the last prompt:
    // the visibility outcome is acknowledged here, once, and every future
    // auto-publish inherits it.
    const disclosure =
      visibility === 'link-only'
        ? 'Sessions from this directory and its worktrees will auto-publish as Link-only on every sync.'
        : 'Sessions from this directory and its worktrees will auto-publish on every sync — Public for supported providers (visible in Explore and search), Link-only otherwise.'
    if (options.yes !== true) {
      if (!ui.interactive) {
        ui.error('Cannot confirm auto-publish visibility without a TTY. Re-run with `--yes`.')
        return 1
      }
      ui.info(disclosure)
      const approved = await ui.confirm(`Subscribe ${path}?`, true)
      if (approved !== true) {
        ui.cancel('Nothing subscribed.')
        return 1
      }
    } else {
      ui.info(disclosure)
    }

    const subscription: Subscription = {
      path,
      visibility,
      addedAt: (dependencies.now ?? (() => new Date().toISOString()))(),
    }
    const { added } = addSubscription(subscription, pickCredentialOptions(dependencies))
    ui.success(added ? `Subscribed ${path}` : `Already subscribed: ${path} (settings updated)`)
    ui.outro(
      `Run \`${formatCliCommand('sync --watch')}\` to keep subscribed sessions continuously published.`,
    )
    return 0
  } catch (cause) {
    ui.error(cause instanceof Error ? cause.message : String(cause))
    return 1
  }
}

export async function handleUnsubscribeCommand(
  directory: string | undefined,
  dependencies: SubscribeCommandDependencies = {},
): Promise<0 | 1> {
  const ui = dependencies.ui ?? createTextUi()
  const cwd = dependencies.cwd ?? process.cwd()
  ui.intro('Unsubscribe a directory')
  try {
    const credentialOptions = pickCredentialOptions(dependencies)
    const input = directory ?? cwd
    let path: string
    try {
      path = canonicalSubscriptionPath(input, cwd)
    } catch {
      // A deleted directory must still be unsubscribable by its stored path.
      path = input
    }
    let { removed } = removeSubscription(path, credentialOptions)
    if (!removed && path !== input) {
      removed = removeSubscription(input, credentialOptions).removed
    }
    if (!removed) {
      ui.warn(`Not subscribed: ${path}`)
      ui.outro('Nothing changed.')
      return 1
    }
    ui.success(`Unsubscribed ${path}. Already-published sessions stay live.`)
    ui.outro(`Use \`${formatCliCommand('withdraw')}\` to take a published session down.`)
    return 0
  } catch (cause) {
    ui.error(cause instanceof Error ? cause.message : String(cause))
    return 1
  }
}

export function handleSubscriptionsCommand(dependencies: SubscribeCommandDependencies = {}): 0 | 1 {
  const ui = dependencies.ui ?? createTextUi()
  try {
    const subscriptions = loadSubscriptions(pickCredentialOptions(dependencies))
    if (subscriptions.length === 0) {
      ui.info(`No subscribed directories. Add one with \`${formatCliCommand('subscribe')}\`.`)
      return 0
    }
    for (const subscription of subscriptions) {
      const visibility = subscription.visibility === 'link-only' ? 'Link-only' : 'provider default'
      ui.info(`${subscription.path}  (${visibility})`)
    }
    return 0
  } catch (cause) {
    ui.error(cause instanceof Error ? cause.message : String(cause))
    return 1
  }
}

export const subscribeCommand = new Command('subscribe')
  .description('Auto-publish sessions from a directory and its worktrees on every sync')
  .argument('[dir]', 'Directory to subscribe; defaults to the current directory')
  .option('--link-only', 'Always publish subscribed sessions as Link-only')
  .option('--yes', 'Skip the one-time visibility confirmation')
  .action(async (dir: string | undefined, opts: { linkOnly?: boolean; yes?: boolean }) => {
    const exitCode = await handleSubscribeCommand(
      dir,
      {
        ...(opts.linkOnly === undefined ? {} : { linkOnly: opts.linkOnly }),
        ...(opts.yes === undefined ? {} : { yes: opts.yes }),
      },
      { ui: createClackUi() },
    )
    if (exitCode !== 0) process.exitCode = exitCode
  })

export const unsubscribeCommand = new Command('unsubscribe')
  .description('Stop auto-publishing sessions from a subscribed directory')
  .argument('[dir]', 'Directory to unsubscribe; defaults to the current directory')
  .action(async (dir: string | undefined) => {
    const exitCode = await handleUnsubscribeCommand(dir, { ui: createClackUi() })
    if (exitCode !== 0) process.exitCode = exitCode
  })

export const subscriptionsCommand = new Command('subscriptions')
  .description('List directories subscribed for auto-publishing')
  .action(() => {
    const exitCode = handleSubscriptionsCommand({ ui: createClackUi() })
    if (exitCode !== 0) process.exitCode = exitCode
  })

function pickCredentialOptions(dependencies: HubCredentialOptions): HubCredentialOptions {
  return {
    ...(dependencies.homeDir === undefined ? {} : { homeDir: dependencies.homeDir }),
    ...(dependencies.env === undefined ? {} : { env: dependencies.env }),
  }
}
