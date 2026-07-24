import { readFileSync } from 'node:fs'

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'

import { resumeCommandOptions } from '../../lib/cli-command'
import { ResumeMenu, ResumeOptionsPanel } from './resume-menu'

const SID = 'claude_test-session'
const source = readFileSync(new URL('./resume-menu.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../../styles/resume-menu.css', import.meta.url), 'utf8')

describe('resumeCommandOptions', () => {
  it('offers an installed-CLI short form and a first-time bootstrap', () => {
    const options = resumeCommandOptions(SID)

    expect(options.map((option) => option.id)).toEqual(['installed', 'bootstrap'])
    expect(options[0]!.command).toBe('spool resume claude_test-session')
    expect(options[1]!.command).toBe(
      'curl -fsSL https://spool.new/install.sh | sh && "${SPOOL_CLI_BIN_DIR:-$HOME/.local/bin}/spool" resume claude_test-session',
    )
  })
})

describe('ResumeMenu', () => {
  it('renders a closed accessible trigger without leaking commands', () => {
    const html = renderToStaticMarkup(<ResumeMenu sid={SID} providerLabel="Claude Code" />)

    expect(html).toContain('Resume in Claude Code')
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('curl -fsSL')
    expect(html).not.toContain('spool resume')
  })
})

describe('ResumeOptionsPanel', () => {
  it('defaults to the installed-CLI command with the bootstrap one tab away', () => {
    const html = renderToStaticMarkup(<ResumeOptionsPanel sid={SID} />)

    expect(html).toContain('role="tablist"')
    expect(html).toMatch(/aria-selected="true"[^>]*>Spool CLI installed/)
    expect(html).toContain('First time — install Spool')
    expect(html).toContain('role="tabpanel"')
    const selectedTabId = html.match(
      /<button[^>]*role="tab"[^>]*id="([^"]+)"[^>]*aria-selected="true"/,
    )?.[1]
    expect(selectedTabId).toBeDefined()
    expect(html).toContain(`aria-labelledby="${selectedTabId}"`)
    expect(html).toMatch(/aria-controls="resume-command-panel-[^"]+"/)
    expect(html).toContain('spool resume claude_test-session')
    // The curl bootstrap is not the default paste anymore.
    expect(html).not.toContain('curl -fsSL')
    expect(html).toContain('aria-label="Copy resume command"')
    expect(html).toContain('This published source stays unchanged.')
  })

  it('uses shared tabs and keeps every mobile action at least 44px', () => {
    expect(source).toContain('<Tabs')
    expect(source).not.toContain('p-0.5')
    expect(source).not.toContain('rounded-[5px]')
    expect(css).toMatch(
      /@media \(max-width: 768px\)[\s\S]*\.resume-menu-trigger,[\s\S]*\.resume-command-tabs \.sp-tabs__tab,[\s\S]*\.resume-command-code,[\s\S]*\.resume-command-copy\s*\{[^}]*min-height:\s*44px;/,
    )
  })

  it('moves focus into the dialog and restores the trigger on Escape', () => {
    expect(source).toContain('?.querySelector<HTMLElement>(\'[role="tab"][aria-selected="true"]\')')
    expect(source).toContain(
      "rootRef.current?.querySelector<HTMLButtonElement>('[data-resume-trigger]')?.focus()",
    )
    expect(source).toContain('role="dialog"')
  })
})
