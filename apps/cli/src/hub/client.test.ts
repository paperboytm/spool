import { describe, expect, it, vi } from 'vite-plus/test'

import { HubClient, HubHttpError } from './client.js'

const SID = 'claude_11111111-2222-4333-8444-555555555555'

describe('HubClient', () => {
  it('POSTs JSON with bearer authentication to the exact session endpoint', async () => {
    const fetchMock = vi.fn(async () => Response.json({ missing: ['oid-b'] }))
    const client = new HubClient({
      hubUrl: 'https://hub.example/',
      token: 'hub-token',
      fetch: fetchMock as typeof fetch,
    })
    const body = {
      root: 'root-1',
      count: 2,
      manifest: ['oid-a', 'oid-b'],
      sig: null,
      cardJson: '{"branch":"main"}',
      summaryMd: '## Outcome\n\nReady for review.',
      lineageJson: null,
      viewOid: 'view-oid',
      spoolFileOid: null,
    }

    await expect(client.pushSession(SID, body)).resolves.toEqual({ missing: ['oid-b'] })
    const [input, init] = fetchMock.mock.calls[0]!
    expect(String(input)).toBe(`https://hub.example/api/hub/v1/sessions/${SID}/push`)
    expect(init).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ ...body, noteMd: body.summaryMd }),
    })
    const headers = new Headers(init?.headers)
    expect(headers.get('authorization')).toBe('Bearer hub-token')
    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.get('accept')).toBe('application/json')
  })

  it('normalizes a legacy noteMd response to the Summary field', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        sid: SID,
        root: 'root-1',
        count: 1,
        sig: null,
        cardJson: null,
        noteMd: '# Legacy summary',
        lineageJson: null,
        viewOid: 'view-oid',
        createdAt: 1,
        updatedAt: 1,
        author: { handle: null, displayName: null, avatarUrl: null },
      }),
    )
    const client = new HubClient({ hubUrl: 'https://hub.example', fetch: fetchMock })

    await expect(client.getSession(SID)).resolves.toMatchObject({
      summaryMd: '# Legacy summary',
    })
  })

  it('uploads object batches as NDJSON', async () => {
    const fetchMock = vi.fn(async () => Response.json({ stored: 2 }))
    const client = new HubClient({
      hubUrl: 'https://spool.new',
      token: 'token',
      fetch: fetchMock as typeof fetch,
    })

    await expect(
      client.uploadObjects([
        { oid: 'oid-a', data: '{"a":1}' },
        { oid: 'oid-b', data: '{"b":2}' },
      ]),
    ).resolves.toEqual({ stored: 2 })

    const [input, init] = fetchMock.mock.calls[0]!
    expect(String(input)).toBe('https://spool.new/api/hub/v1/objects/batch')
    expect(init?.body).toBe(
      '{"oid":"oid-a","data":"{\\"a\\":1}"}\n' + '{"oid":"oid-b","data":"{\\"b\\":2}"}\n',
    )
    expect(new Headers(init?.headers).get('content-type')).toBe('application/x-ndjson')
  })

  it('streams split NDJSON response lines from the records endpoint', async () => {
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"i":0,"oid":"a","data":"one"}\n{"i":'))
        controller.enqueue(encoder.encode('1,"oid":"b","data":"two"}\r\n'))
        controller.close()
      },
    })
    const fetchMock = vi.fn(async () => new Response(body, { status: 200 }))
    const client = new HubClient({
      hubUrl: 'https://spool.new',
      fetch: fetchMock as typeof fetch,
    })

    const records = []
    for await (const record of client.getSessionRecords(SID, { from: 0, to: 2 })) {
      records.push(record)
    }

    expect(records).toEqual([
      { i: 0, oid: 'a', data: 'one' },
      { i: 1, oid: 'b', data: 'two' },
    ])
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      `https://spool.new/api/hub/v1/sessions/${SID}/records?from=0&to=2`,
    )
  })

  it('POSTs to the contract token endpoint without requiring a request body', async () => {
    const fetchMock = vi.fn(async () => Response.json({ token: 'new-token' }))
    const client = new HubClient({
      hubUrl: 'https://spool.new',
      fetch: fetchMock as typeof fetch,
    })

    await expect(client.createToken()).resolves.toEqual({ token: 'new-token' })
    const [input, init] = fetchMock.mock.calls[0]!
    expect(String(input)).toBe('https://spool.new/api/hub/v1/tokens')
    expect(init).toMatchObject({ method: 'POST' })
    expect(init?.body).toBeUndefined()
  })

  it('requests a one-use resume grant at the verified record position', async () => {
    const fetchMock = vi.fn(async () => Response.json({ version: 1, token: 'resume-proof' }))
    const client = new HubClient({
      hubUrl: 'https://spool.new',
      token: 'hub-token',
      fetch: fetchMock as typeof fetch,
    })

    await expect(client.createResumeGrant(SID, 42)).resolves.toEqual({
      version: 1,
      token: 'resume-proof',
    })
    const [input, init] = fetchMock.mock.calls[0]!
    expect(String(input)).toBe(`https://spool.new/api/hub/v1/sessions/${SID}/resume-grant`)
    expect(init).toMatchObject({ method: 'POST', body: '{"position":42}' })
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer hub-token')
  })

  it.each([
    [401, { message: 'invalid token' }, 'invalid token'],
    [404, { error: 'NOT_FOUND', detail: 'session missing' }, 'session missing'],
    [410, { error: 'GONE', detail: 'withdrawn' }, 'withdrawn'],
  ])('throws a typed error for HTTP %s', async (status, body, message) => {
    const fetchMock = vi.fn(
      async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }),
    )
    const client = new HubClient({
      hubUrl: 'https://spool.new',
      token: 'bad-token',
      fetch: fetchMock as typeof fetch,
    })

    const error = await client.withdrawSession(SID).catch((value) => value as unknown)
    expect(error).toBeInstanceOf(HubHttpError)
    expect(error).toMatchObject({ status, bodyMessage: message })
  })

  it('names the hub and hints at local dev when the connection fails', async () => {
    const refused = new TypeError('fetch failed')
    ;(refused as { cause?: Error }).cause = new Error('connect ECONNREFUSED 127.0.0.1:3002')
    const client = new HubClient({
      hubUrl: 'http://127.0.0.1:3002',
      fetch: (async () => {
        throw refused
      }) as typeof fetch,
    })
    await expect(client.getSession(SID)).rejects.toThrow(
      /Cannot reach the hub at http:\/\/127\.0\.0\.1:3002 \(connect ECONNREFUSED.*Is the local hub running/,
    )
  })

  it('constructs without hanging when the hub URL has a huge run of non-trailing slashes (ReDoS probe)', () => {
    // normalizeHubUrl's old `/\/+$/` trim backtracks polynomially once the
    // slash run isn't at the very end of the string (measured multi-second
    // hangs at 100k slashes on the pre-fix regex vs. sub-millisecond here).
    const hostileUrl = `https://hub.example${'/'.repeat(100_000)}x`
    const start = Date.now()
    const client = new HubClient({
      hubUrl: hostileUrl,
      fetch: (async () => Response.json({})) as typeof fetch,
    })
    const elapsedMs = Date.now() - start

    expect(elapsedMs).toBeLessThan(2_000)
    expect(client).toBeInstanceOf(HubClient)
  })
})
