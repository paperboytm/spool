import { describe, expect, it } from 'vitest'

import { firstLinePreview } from './first-line-preview'

describe('firstLinePreview', () => {
  it('matches the desktop turn selector cleanup rules', () => {
    expect(firstLinePreview('\n  ## `Review` the metadata layout\nMore context')).toBe(
      'Review the metadata layout',
    )
    expect(firstLinePreview('> quoted prompt')).toBe('quoted prompt')
    expect(firstLinePreview('- list prompt')).toBe('list prompt')
  })

  it('uses only the first non-empty line', () => {
    expect(firstLinePreview('\n  First prompt  \nSecond prompt')).toBe('First prompt')
  })

  it('returns an empty string for blank or fence-only content', () => {
    expect(firstLinePreview(' \n\t ')).toBe('')
    expect(firstLinePreview('```ts\nconst value = 1')).toBe('')
  })
})
