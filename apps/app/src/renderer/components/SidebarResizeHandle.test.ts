import { describe, expect, it } from 'vite-plus/test'

import { clampSidebarWidth } from './SidebarResizeHandle.js'

describe('clampSidebarWidth', () => {
  it('rounds values and enforces the supported range', () => {
    expect(clampSidebarWidth(199)).toBe(200)
    expect(clampSidebarWidth(247.6)).toBe(248)
    expect(clampSidebarWidth(361)).toBe(360)
  })
})
