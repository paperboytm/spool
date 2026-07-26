import { readFileSync } from 'node:fs'

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vite-plus/test'

import {
  Avatar,
  Badge,
  Button,
  ButtonLink,
  IconButton,
  IconLink,
  ListRow,
  MobileMenu,
  NavItem,
  SearchField,
  SectionLabel,
  Tabs,
  Wordmark,
} from './index.js'

const componentSource = readFileSync(new URL('./components.tsx', import.meta.url), 'utf8')

describe('button primitives', () => {
  it('render the correct semantic elements and visual variants', () => {
    const button = renderToStaticMarkup(
      <Button variant="accent" size="sm">
        Publish
      </Button>,
    )
    const link = renderToStaticMarkup(
      <ButtonLink href="/explore" variant="outline" size="md">
        Explore
      </ButtonLink>,
    )
    const danger = renderToStaticMarkup(
      <Button variant="danger" size="lg">
        Delete
      </Button>,
    )

    expect(button).toContain('<button')
    expect(button).toContain('type="button"')
    expect(button).toContain('data-variant="accent"')
    expect(button).toContain('data-size="sm"')
    expect(link).toContain('<a href="/explore"')
    expect(link).toContain('data-variant="outline"')
    expect(danger).toContain('data-variant="danger"')
    expect(danger).toContain('data-size="lg"')
  })

  it('models loading separately from an unavailable action', () => {
    const loading = renderToStaticMarkup(
      <Button variant="accent" loading loadingLabel="Sending…">
        Send invite
      </Button>,
    )
    const disabled = renderToStaticMarkup(<Button disabled>Save name</Button>)

    expect(loading).toContain('aria-busy="true"')
    expect(loading).toContain('disabled=""')
    expect(loading).toContain('data-state="loading"')
    expect(loading).toContain('sp-button__spinner')
    expect(loading).toContain('Sending…')
    expect(loading).not.toContain('Send invite')
    expect(disabled).toContain('disabled=""')
    expect(disabled).not.toContain('aria-busy="true"')
    expect(disabled).not.toContain('data-state="loading"')
  })

  it('requires and forwards accessible labels for icon controls', () => {
    const button = renderToStaticMarkup(<IconButton aria-label="Pin session">P</IconButton>)
    const link = renderToStaticMarkup(
      <IconLink aria-label="Open session" href="/sessions/1">
        O
      </IconLink>,
    )

    expect(button).toContain('aria-label="Pin session"')
    expect(button).toContain('<button')
    expect(link).toContain('aria-label="Open session"')
    expect(link).toContain('<a')
  })
})

describe('MobileMenu', () => {
  it('renders a labelled 44px disclosure trigger and keeps its panel in the DOM', () => {
    const html = renderToStaticMarkup(
      <MobileMenu
        className="site-menu"
        triggerLabel="Open navigation"
        closeLabel="Close navigation"
      >
        <nav aria-label="Mobile navigation">
          <a href="/explore">Explore</a>
        </nav>
      </MobileMenu>,
    )
    const defaults = renderToStaticMarkup(
      <MobileMenu>
        <span>Menu content</span>
      </MobileMenu>,
    )

    expect(html).toContain('sp-mobile-menu site-menu')
    expect(html).toContain('class="sp-mobile-menu__trigger"')
    expect(html).toContain('aria-label="Open navigation"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toMatch(/aria-controls="sp-mobile-menu-panel-[^"]+"/)
    const triggerId = html.match(/id="(sp-mobile-menu-trigger-[^"]+)"/)?.[1]
    expect(triggerId).toBeDefined()
    expect(html).toContain(`aria-labelledby="${triggerId}"`)
    expect(html).toContain('class="sp-mobile-menu__panel"')
    expect(html).toContain('hidden=""')
    expect(html).toContain('Mobile navigation')
    expect(html).toContain('Explore')
    expect(defaults).toContain('aria-label="Open menu"')
  })

  it('dismisses after menu actions as well as Escape and outside pointer presses', () => {
    expect(componentSource).toContain('onClickCapture')
    expect(componentSource).toContain("target.closest('a,button')")
    expect(componentSource).toContain("document.addEventListener('pointerdown'")
    expect(componentSource).toContain("event.key !== 'Escape'")
    expect(componentSource).toContain("closeLabel = 'Close menu'")
  })
})

describe('controlled primitives', () => {
  it('renders a controlled search input with a semantic clear action', () => {
    const html = renderToStaticMarkup(
      <SearchField
        aria-label="Search sessions"
        value="agent"
        onChange={vi.fn()}
        onClear={vi.fn()}
        clearLabel="Clear query"
      />,
    )

    expect(html).toContain('type="search"')
    expect(html).toContain('value="agent"')
    expect(html).toContain('aria-label="Search sessions"')
    expect(html).toContain('aria-label="Clear query"')
  })

  it('marks the controlled tab value and disabled items correctly', () => {
    const html = renderToStaticMarkup(
      <Tabs
        aria-label="Session views"
        value="summary"
        onValueChange={vi.fn()}
        items={[
          {
            value: 'summary',
            label: 'Summary',
            id: 'summary-tab',
            ariaControls: 'summary-panel',
          },
          { value: 'record', label: 'Record', disabled: true },
        ]}
      />,
    )

    expect(html).toContain('role="tablist"')
    expect(html).toContain('aria-label="Session views"')
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('id="summary-tab"')
    expect(html).toContain('aria-controls="summary-panel"')
    expect(html).toContain('disabled=""')
  })
})

describe('content primitives', () => {
  it('renders link and button navigation with explicit active state', () => {
    const link = renderToStaticMarkup(
      <NavItem href="/explore" active leading="L" trailing="T">
        Explore
      </NavItem>,
    )
    const button = renderToStaticMarkup(<NavItem>Projects</NavItem>)
    const disclosure = renderToStaticMarkup(
      <NavItem active current={false} aria-expanded="true">
        Teams
      </NavItem>,
    )

    expect(link).toContain('<a')
    expect(link).toContain('aria-current="page"')
    expect(link).toContain('sp-nav-item__leading')
    expect(link).toContain('sp-nav-item__trailing')
    expect(button).toContain('<button')
    expect(button).toContain('type="button"')
    expect(disclosure).toContain('data-active="true"')
    expect(disclosure).not.toContain('aria-current')
  })

  it('renders badge variants and avatar image fallbacks', () => {
    const badge = renderToStaticMarkup(<Badge variant="source-codex">Codex</Badge>)
    const fallback = renderToStaticMarkup(<Avatar name="Ada Lovelace" alt="Ada" />)
    const emojiFallback = renderToStaticMarkup(<Avatar name="🧑 Builder" />)
    const image = renderToStaticMarkup(
      <Avatar src="https://example.test/ada.png" name="Ada Lovelace" alt="Ada" />,
    )

    expect(badge).toContain('data-variant="source-codex"')
    expect(fallback).toContain('sp-avatar__fallback')
    expect(fallback).toContain('>AL</span>')
    expect(fallback).toContain('role="img"')
    expect(emojiFallback).toContain('>🧑B</span>')
    expect(image).toContain('<img')
    expect(image).toContain('referrerPolicy="no-referrer"')
  })

  it('keeps Session interpretation, evidence, and lineage in named row slots', () => {
    const html = renderToStaticMarkup(
      <ListRow
        leading={<Avatar name="Lin" />}
        attribution="@lin · published 2h ago"
        title="Ship the shared UI foundation"
        summary="A concise interpretation of the work."
        metadata="12 messages · 4 files"
        lineage="Continued from @lin/original"
        trailing={<Button>Resume</Button>}
      />,
    )

    expect(html).toContain('<article')
    expect(html).toContain('sp-list-row__attribution')
    expect(html).toContain('sp-list-row__summary')
    expect(html).toContain('sp-list-row__metadata')
    expect(html).toContain('sp-list-row__lineage')
    expect(html).toContain('data-leading="true"')
    expect(html).toContain('data-trailing="true"')
  })

  it('renders section slots and the canonical attributed wordmark', () => {
    const section = renderToStaticMarkup(
      <SectionLabel count={3} action={<button type="button">Sort</button>}>
        Public sessions
      </SectionLabel>,
    )
    const wordmark = renderToStaticMarkup(<Wordmark />)

    expect(section).toContain('sp-section-label__count')
    expect(section).toContain('sp-section-label__action')
    expect(wordmark).toContain('Spool')
    expect(wordmark).toContain('sp-wordmark__dot')
  })
})
