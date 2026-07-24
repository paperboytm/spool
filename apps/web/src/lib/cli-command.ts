export const CLI_INSTALL_COMMAND = 'curl -fsSL https://spool.new/install.sh | sh'

const INSTALLED_CLI_PATH = '"${SPOOL_CLI_BIN_DIR:-$HOME/.local/bin}/spool"'

/** A terminal-safe bootstrap: installation runs in a pipe, then the agent is
 * launched by the caller's shell so Resume keeps the terminal's stdin/TTY. */
export function resumeBootstrapCommand(sid: string): string {
  return `${CLI_INSTALL_COMMAND} && ${INSTALLED_CLI_PATH} resume ${sid}`
}

/** The short form for people who already have `spool` on PATH. */
export function resumeInstalledCommand(sid: string): string {
  return `spool resume ${sid}`
}

export interface ResumeCommandOption {
  id: 'installed' | 'bootstrap'
  label: string
  description: string
  command: string
}

/**
 * The Resume popup offers one command per situation instead of forcing the
 * curl bootstrap on everyone: an installed CLI resumes with the plain
 * `spool` binary, a first-time visitor gets install + resume in one paste.
 */
export function resumeCommandOptions(sid: string): ResumeCommandOption[] {
  return [
    {
      id: 'installed',
      label: 'Spool CLI installed',
      description: 'Continues this Session locally with your existing install.',
      command: resumeInstalledCommand(sid),
    },
    {
      id: 'bootstrap',
      label: 'First time — install Spool',
      description: 'Installs or updates the Spool CLI, then continues locally.',
      command: resumeBootstrapCommand(sid),
    },
  ]
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
