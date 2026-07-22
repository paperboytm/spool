export const CLI_INSTALL_COMMAND = 'curl -fsSL https://spool.new/install.sh | sh'

const INSTALLED_CLI_PATH = '"${SPOOL_CLI_BIN_DIR:-$HOME/.local/bin}/spool"'

/** A terminal-safe bootstrap: installation runs in a pipe, then the agent is
 * launched by the caller's shell so Resume keeps the terminal's stdin/TTY. */
export function resumeBootstrapCommand(sid: string): string {
  return `${CLI_INSTALL_COMMAND} && ${INSTALLED_CLI_PATH} resume ${sid}`
}

export type CopyCommandState = 'idle' | 'copied' | 'failed'

export async function copyCommandText(
  value: string,
  writeText?: (text: string) => Promise<void>,
): Promise<Exclude<CopyCommandState, 'idle'>> {
  try {
    await (writeText ?? ((text) => navigator.clipboard.writeText(text)))(value)
    return 'copied'
  } catch {
    return 'failed'
  }
}
