/**
 * Demo cursor overlay for launch-video captures.
 *
 * Playwright's `page.mouse.move/click` dispatch synthetic DOM events but
 * don't move the real OS cursor, and `screencapture -V` films native
 * pixels — so there's no pointer in frame unless we draw one ourselves.
 *
 * This installs a DOM-rendered arrow that tracks the synthetic mouse
 * position via a capture-phase `mousemove` listener, plus a brief ring
 * pulse on `mousedown` so clicks read as clicks rather than as state
 * changes that "just happen". Pointer events stay off so the overlay
 * never intercepts a real click target.
 */
import type { Page } from '@playwright/test'

const OVERLAY_SCRIPT = `
(function () {
  if (window.__spoolDemoCursorInstalled) return
  window.__spoolDemoCursorInstalled = true

  function install() {
    if (document.getElementById('spool-demo-cursor')) return
    const style = document.createElement('style')
    style.textContent = [
      '#spool-demo-cursor{position:fixed;left:0;top:0;width:22px;height:22px;',
      'pointer-events:none;z-index:2147483647;will-change:transform;',
      'transition:transform 60ms linear}',
      '#spool-demo-cursor svg{display:block;width:100%;height:100%;',
      'filter:drop-shadow(0 1.5px 2.5px rgba(0,0,0,0.55))}',
      '#spool-demo-cursor .ring{position:absolute;left:-10px;top:-10px;',
      'width:42px;height:42px;border-radius:50%;border:2px solid rgba(255,255,255,0.95);',
      'opacity:0;pointer-events:none;box-shadow:0 0 0 1px rgba(0,0,0,0.35)}',
      '#spool-demo-cursor .ring.pulse{animation:spool-cursor-pulse 0.42s ease-out forwards}',
      '@keyframes spool-cursor-pulse{',
      '0%{transform:scale(0.35);opacity:0.95}',
      '70%{opacity:0.4}',
      '100%{transform:scale(1.55);opacity:0}}'
    ].join('')
    document.head.appendChild(style)

    const root = document.createElement('div')
    root.id = 'spool-demo-cursor'
    root.innerHTML = [
      '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">',
      '<path d="M3 2 L3 18 L7.2 13.8 L9.6 19.4 L12.2 18.3 L9.8 12.7 L15.4 12.7 Z" ',
      'fill="#ffffff" stroke="#181818" stroke-width="1.2" stroke-linejoin="round"/>',
      '</svg>',
      '<span class="ring"></span>'
    ].join('')
    document.body.appendChild(root)

    const ring = root.querySelector('.ring')
    let x = window.innerWidth / 2
    let y = window.innerHeight / 2
    function place() {
      root.style.transform = 'translate(' + (x - 2) + 'px,' + (y - 2) + 'px)'
    }
    place()

    document.addEventListener('mousemove', function (e) {
      x = e.clientX
      y = e.clientY
      place()
    }, { capture: true, passive: true })

    document.addEventListener('mousedown', function () {
      if (!ring) return
      ring.classList.remove('pulse')
      void ring.offsetWidth
      ring.classList.add('pulse')
    }, { capture: true, passive: true })
  }

  if (document.body) install()
  else document.addEventListener('DOMContentLoaded', install)
})()
`

export async function installCursorOverlay(window: Page): Promise<void> {
  await window.addInitScript(OVERLAY_SCRIPT)
  await window.evaluate(OVERLAY_SCRIPT)
}

export interface MoveOptions {
  steps?: number
  settle?: number
}

export interface MoveAndClickOptions extends MoveOptions {
  preClickPause?: number
  postClickPause?: number
}

async function centerOf(window: Page, selector: string): Promise<{ x: number; y: number }> {
  const locator = window.locator(selector).first()
  await locator.waitFor({ state: 'visible', timeout: 6000 })
  const box = await locator.boundingBox()
  if (!box) throw new Error(`No bounding box for ${selector}`)
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

export async function cursorTo(window: Page, selector: string, opts: MoveOptions = {}): Promise<void> {
  const { x, y } = await centerOf(window, selector)
  await window.mouse.move(x, y, { steps: opts.steps ?? 16 })
  if (opts.settle) await window.waitForTimeout(opts.settle)
}

export async function cursorClick(
  window: Page,
  selector: string,
  opts: MoveAndClickOptions = {},
): Promise<void> {
  await cursorTo(window, selector, { steps: opts.steps, settle: opts.preClickPause ?? 220 })
  await window.locator(selector).first().click()
  if (opts.postClickPause) await window.waitForTimeout(opts.postClickPause)
}

/** Park the cursor at an idle position so it doesn't sit on top of the
 *  next clickable element awkwardly between beats. Coords are in CSS
 *  pixels of the renderer window. */
export async function cursorPark(window: Page, x: number, y: number, steps = 14): Promise<void> {
  await window.mouse.move(x, y, { steps })
}
