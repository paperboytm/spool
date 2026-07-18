// Coverage for the optional .spool attachment: it rides the same
// content-addressed pipeline as records/view (declared on the head,
// counted in missing, uploaded via batch) and is served back with the
// view object's caching semantics.

import type { KVNamespace } from '@cloudflare/workers-types'
import { canonicalizeRecord, sequenceRoot } from '@spool-lab/session-kit'
import { describe, expect, it } from 'vite-plus/test'

import { onRequestPost as batchPost } from '../functions/api/hub/v1/objects/batch'
import { onRequestPost as headPost } from '../functions/api/hub/v1/sessions/[sid]/head'
import { onRequestGet as metaGet } from '../functions/api/hub/v1/sessions/[sid]/index'
import { onRequestPost as pushPost } from '../functions/api/hub/v1/sessions/[sid]/push'
import { onRequestGet as spoolFileGet } from '../functions/api/hub/v1/sessions/[sid]/spool-file'
import { invoke } from './_helpers/ctx'
import { emptyState, makeDb, makeKv, makeR2 } from './_helpers/fakes'

const DEV_TOKEN = 'spool-file-test-token'
const SID = 'claude_11111111-2222-4333-8444-555555555555'

function makeEnv() {
  const { db } = makeDb(emptyState())
  return {
    DB: db,
    SESSIONS: makeKv() as KVNamespace,
    RATE: makeKv() as KVNamespace,
    HUB: makeR2().bucket,
    HUB_DEV_TOKEN: DEV_TOKEN,
    PUBLIC_BASE_URL: 'https://hub.test',
  }
}
type Env = ReturnType<typeof makeEnv>

const auth = { authorization: `Bearer ${DEV_TOKEN}` }

async function shareWithSpoolFile(env: Env) {
  const record = await canonicalizeRecord(
    JSON.stringify({
      type: 'user',
      uuid: 'u-1',
      sessionId: 's',
      message: { role: 'user', content: 'hello' },
    }),
  )
  const view = await canonicalizeRecord(
    JSON.stringify({
      v: 1,
      index: [],
      files: [],
      outline: [],
      firstPrompt: 'hello',
      lastReply: '',
      diffstat: { files: 0, adds: 0, dels: 0 },
    }),
  )
  const spoolFile = await canonicalizeRecord(
    JSON.stringify({
      version: 2,
      exportedAt: '2026-07-16T12:00:00.000Z',
      conversation: { title: 'hello doc', turns: [{ role: 'user', body: 'hello' }] },
      opts: { template: 'letter' },
    }),
  )
  const head = {
    root: await sequenceRoot([record.oid]),
    count: 1,
    manifest: [record.oid],
    sig: null,
    cardJson: null,
    summaryMd: null,
    lineageJson: null,
    viewOid: view.oid,
    spoolFileOid: spoolFile.oid,
  }

  const pushRes = await invoke(
    pushPost,
    new Request(`https://hub.test/api/hub/v1/sessions/${SID}/push`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify(head),
    }),
    env,
    { sid: SID },
  )
  const { missing } = (await pushRes.json()) as { missing: string[] }

  const lines = [record, view, spoolFile]
    .filter((object) => missing.includes(object.oid))
    .map((object) => JSON.stringify({ oid: object.oid, data: object.data }))
    .join('\n')
  await invoke(
    batchPost,
    new Request('https://hub.test/api/hub/v1/objects/batch', {
      method: 'POST',
      headers: auth,
      body: lines,
    }),
    env,
  )

  const headRes = await invoke(
    headPost,
    new Request(`https://hub.test/api/hub/v1/sessions/${SID}/head`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify(head),
    }),
    env,
    { sid: SID },
  )
  return { head, spoolFile, missing, headStatus: headRes.status }
}

describe('hub spool-file attachment', () => {
  it('counts the spool file in missing, commits it on the head, and serves it back', async () => {
    const env = makeEnv()
    const { head, spoolFile, missing, headStatus } = await shareWithSpoolFile(env)
    expect(missing).toContain(spoolFile.oid)
    expect(headStatus).toBe(200)

    const metaRes = await invoke(
      metaGet,
      new Request(`https://hub.test/api/hub/v1/sessions/${SID}`),
      env,
      { sid: SID },
    )
    const meta = (await metaRes.json()) as { spoolFileOid: string | null; viewOid: string }
    expect(meta.spoolFileOid).toBe(head.spoolFileOid)

    const fileRes = await invoke(
      spoolFileGet,
      new Request(`https://hub.test/api/hub/v1/sessions/${SID}/spool-file`),
      env,
      { sid: SID },
    )
    expect(fileRes.status).toBe(200)
    expect(fileRes.headers.get('content-type')).toBe('application/spool+json')
    expect(await fileRes.text()).toBe(spoolFile.data)

    const cached = await invoke(
      spoolFileGet,
      new Request(`https://hub.test/api/hub/v1/sessions/${SID}/spool-file`, {
        headers: { 'if-none-match': `"${spoolFile.oid}"` },
      }),
      env,
      { sid: SID },
    )
    expect(cached.status).toBe(304)
  })

  it('404s the spool-file endpoint when the share carries none', async () => {
    const env = makeEnv()
    const record = await canonicalizeRecord(
      '{"type":"user","message":{"role":"user","content":"x"}}',
    )
    const view = await canonicalizeRecord('{"v":1}')
    const head = {
      root: await sequenceRoot([record.oid]),
      count: 1,
      manifest: [record.oid],
      sig: null,
      cardJson: null,
      summaryMd: null,
      lineageJson: null,
      viewOid: view.oid,
      // No spoolFileOid at all — older clients omit the field entirely.
    }
    await invoke(
      pushPost,
      new Request(`https://hub.test/api/hub/v1/sessions/${SID}/push`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify(head),
      }),
      env,
      { sid: SID },
    )
    await invoke(
      batchPost,
      new Request('https://hub.test/api/hub/v1/objects/batch', {
        method: 'POST',
        headers: auth,
        body: [record, view].map((o) => JSON.stringify({ oid: o.oid, data: o.data })).join('\n'),
      }),
      env,
    )
    const headRes = await invoke(
      headPost,
      new Request(`https://hub.test/api/hub/v1/sessions/${SID}/head`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify(head),
      }),
      env,
      { sid: SID },
    )
    expect(headRes.status).toBe(200)

    const fileRes = await invoke(
      spoolFileGet,
      new Request(`https://hub.test/api/hub/v1/sessions/${SID}/spool-file`),
      env,
      { sid: SID },
    )
    expect(fileRes.status).toBe(404)
  })
})
