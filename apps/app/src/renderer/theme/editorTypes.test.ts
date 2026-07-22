import { describe, expect, it } from 'vite-plus/test'

import { defaultThemeEditorState, normalizeThemeEditorState } from './editorTypes'

describe('Spool theme defaults', () => {
  it('uses the Paperboy blue and void palette', () => {
    expect(defaultThemeEditorState()).toMatchObject({
      light: { accent: '#1387FF', background: '#FFFFFF', foreground: '#0A0A0A' },
      dark: { accent: '#5BB1F0', background: '#000000', foreground: '#FFFFFF' },
    })
  })

  it('migrates exact pre-rebrand defaults without replacing custom themes', () => {
    const legacy = {
      v: 1,
      light: {
        ...defaultThemeEditorState().light,
        contrast: 73,
        accent: '#C85A00',
        background: '#FAFAF8',
        foreground: '#1C1C18',
      },
      dark: {
        ...defaultThemeEditorState().dark,
        accent: '#F07020',
        background: '#141410',
        foreground: '#F2F2EC',
      },
    }
    expect(normalizeThemeEditorState(legacy)).toEqual({
      ...defaultThemeEditorState(),
      light: { ...defaultThemeEditorState().light, contrast: 73 },
    })

    legacy.light.accent = '#123456'
    expect(normalizeThemeEditorState(legacy)?.light.accent).toBe('#123456')
  })
})
