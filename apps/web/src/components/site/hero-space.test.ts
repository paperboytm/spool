import { describe, expect, it } from 'vite-plus/test'

import { getHeroRenderPolicy, parseCssColor } from './hero-space'

describe('HeroSpace theme rendering', () => {
  it('recognizes minified short-hex light theme tokens', () => {
    expect(parseCssColor('#fff', { r: 0, g: 0, b: 0 })).toEqual({
      r: 255,
      g: 255,
      b: 255,
    })
  })

  it('ignores alpha while parsing short and long alpha hex tokens', () => {
    expect(parseCssColor('#1387', { r: 0, g: 0, b: 0 })).toEqual({
      r: 17,
      g: 51,
      b: 136,
    })
    expect(parseCssColor('#1387ffff', { r: 0, g: 0, b: 0 })).toEqual({
      r: 19,
      g: 135,
      b: 255,
    })
  })

  it('composites light mode onto the shared page background without bloom post-processing', () => {
    expect(getHeroRenderPolicy(false)).toEqual({
      transparentCanvas: true,
      clearAlpha: 0,
      postProcessing: false,
    })
  })

  it('keeps the opaque bloom pipeline for the dark-mode scene', () => {
    expect(getHeroRenderPolicy(true)).toEqual({
      transparentCanvas: false,
      clearAlpha: 1,
      postProcessing: true,
    })
  })
})
