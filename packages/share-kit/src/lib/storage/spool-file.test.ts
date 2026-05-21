import { describe, it, expect } from 'vitest'
import { buildSpoolDocument } from './spool-file'
import { hashValueForRedactExclude } from '@spool-lab/redact'
import { DEFAULT_OPTS, type Conversation, type EditorOpts } from '../types'

// Built at runtime so GitHub's push-protection secret scanner
// doesn't flag the literal Stripe-shaped prefix in source.
const STRIPE_FIXTURE = 'sk_' + 'live_' + 'aH1xK9pQrSt7VwYzA3bC5dF8gJ'
// Email in a non-reserved domain — example.com is now filtered.
const EMAIL_FIXTURE = 'maya@hogwarts.edu'
const EMAIL_MASK = 'm***@hogwarts.edu'

function makeConvo(): Conversation {
  return {
    title: 'leak demo',
    sourceLabel: 'Claude',
    sourcePlatform: 'Claude',
    createdAt: '2026-05-15T00:00:00Z',
    turns: [
      {
        role: 'user',
        body: `paste my key ${STRIPE_FIXTURE} for testing`,
        author: '[Maya]',
      } as Conversation['turns'][number],
      {
        role: 'assistant',
        body: `sure — but ${EMAIL_FIXTURE} is in the body too`,
      } as Conversation['turns'][number],
    ],
  }
}

describe('buildSpoolDocument', () => {
  it('default (no sanitize) embeds the raw conversation and opts', () => {
    const convo = makeConvo()
    const opts: EditorOpts = { ...DEFAULT_OPTS, redact: true }
    const doc = buildSpoolDocument(convo, opts)
    expect(doc.conversation.turns[0]!.body).toContain(STRIPE_FIXTURE)
    expect(doc.opts).toEqual(opts)
  })

  it('sanitize=true replaces each literal with its per-kind mask', () => {
    const convo = makeConvo()
    const opts: EditorOpts = { ...DEFAULT_OPTS, redact: true }
    const doc = buildSpoolDocument(convo, opts, { sanitize: true })
    expect(doc.conversation.turns[0]!.body).not.toContain(STRIPE_FIXTURE)
    expect(doc.conversation.turns[0]!.body).toContain('[redacted: Stripe key]')
    expect(doc.conversation.turns[1]!.body).not.toContain(EMAIL_FIXTURE)
    expect(doc.conversation.turns[1]!.body).toContain(EMAIL_MASK)
    expect(doc.conversation.turns[0]!.author).toBe('[[redacted name]]')
  })

  it('sanitize=true with redact=false leaves the body alone', () => {
    const convo = makeConvo()
    const opts: EditorOpts = { ...DEFAULT_OPTS, redact: false }
    const doc = buildSpoolDocument(convo, opts, { sanitize: true })
    expect(doc.conversation.turns[0]!.body).toContain(STRIPE_FIXTURE)
  })

  it('sanitize=true strips redactExclude from the embedded opts', () => {
    const convo = makeConvo()
    const opts: EditorOpts = {
      ...DEFAULT_OPTS,
      redact: true,
      redactExclude: {
        kinds: ['absolute-path'],
        valueHashes: [hashValueForRedactExclude(EMAIL_FIXTURE)],
      },
    }
    const doc = buildSpoolDocument(convo, opts, { sanitize: true })
    expect(doc.opts.redactExclude).toBeUndefined()
    // And the email IS still in the sanitised body because the per-
    // item opt-out asked us to keep it.
    expect(doc.conversation.turns[1]!.body).toContain(EMAIL_FIXTURE)
  })

  it('sanitize=false preserves redactExclude in the embedded opts', () => {
    const convo = makeConvo()
    const opts: EditorOpts = {
      ...DEFAULT_OPTS,
      redact: true,
      redactExclude: { kinds: ['absolute-path'] },
    }
    const doc = buildSpoolDocument(convo, opts)
    expect(doc.opts.redactExclude?.kinds).toEqual(['absolute-path'])
  })

  it('valueHashes can keep a specific item visible in the sanitised body', () => {
    const convo = makeConvo()
    const opts: EditorOpts = {
      ...DEFAULT_OPTS,
      redact: true,
      redactExclude: { valueHashes: [hashValueForRedactExclude(EMAIL_FIXTURE)] },
    }
    const doc = buildSpoolDocument(convo, opts, { sanitize: true })
    expect(doc.conversation.turns[1]!.body).toContain(EMAIL_FIXTURE)
    expect(doc.conversation.turns[0]!.body).not.toContain(STRIPE_FIXTURE)
  })
})
