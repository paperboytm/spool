export const DEFAULT_CLI_INVOCATION = 'npx @spool-lab/cli'

export function formatCliCommand(argumentsText: string): string {
  return `${DEFAULT_CLI_INVOCATION} ${argumentsText}`
}
