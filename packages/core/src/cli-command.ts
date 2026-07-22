export const DEFAULT_CLI_INVOCATION = 'spool'
export const CLI_INSTALL_DOCS_URL = 'https://spool.new/docs/installation'

export function formatCliCommand(argumentsText: string): string {
  return `${DEFAULT_CLI_INVOCATION} ${argumentsText}`
}

export function formatCliInstallHint(): string {
  return (
    'If `spool` is unavailable, run `npx @spool-lab/cli login` now, ' +
    `or install it from ${CLI_INSTALL_DOCS_URL}.`
  )
}
