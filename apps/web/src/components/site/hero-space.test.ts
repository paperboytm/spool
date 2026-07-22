import { describe, expect, it } from 'vite-plus/test'

import { getHeroRenderPolicy } from './hero-space'

describe('HeroSpace theme rendering', () => {
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
