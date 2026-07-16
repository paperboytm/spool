import { describe, expect, it, vi } from 'vitest'
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
      noteMd: 'Ready for review',
      lineageJson: null,
      viewOid: 'view-oid',
    }

    await expect(client.pushSession(SID, body)).resolves.toEqual({ missing: ['oid-b'] })
    const [input, init] = fetchMock.mock.calls[0]!
    expect(String(input)).toBe(`https://hub.example/api/hub/v1/sessions/${SID}/push`)
    expect(init).toMatchObject({ method: 'POST', body: JSON.stringify(body) })
    const headers = new Headers(init?.headers)
    expect(headers.get('authorization')).toBe('Bearer hub-token')
    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.get('accept')).toBe('application/json')
  })

  it('uploads object batches as NDJSON', async () => {
    const fetchMock = vi.fn(async () => Response.json({ stored: 2 }))
    const client = new HubClient({
      hubUrl: 'https://spool.pro',
      token: 'token',
      fetch: fetchMock as typeof fetch,
    })

    await expect(client.uploadObjects([
      { oid: 'oid-a', data: '{"a":1}' },
      { oid: 'oid-b', data: '{"b":2}' },
    ])).resolves.toEqual({ stored: 2 })

    const [input, init] = fetchMock.mock.calls[0]!
    expect(String(input)).toBe('https://spool.pro/api/hub/v1/objects/batch')
    expect(init?.body).toBe(
      '{"oid":"oid-a","data":"{\\"a\\":1}"}\n' +
      '{"oid":"oid-b","data":"{\\"b\\":2}"}\n',
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
      hubUrl: 'https://spool.pro',
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
      `https://spool.pro/api/hub/v1/sessions/${SID}/records?from=0&to=2`,
    )
  })

  it('POSTs to the contract token endpoint without requiring a request body', async () => {
    const fetchMock = vi.fn(async () => Response.json({ token: 'new-token' }))
    const client = new HubClient({
      hubUrl: 'https://spool.pro',
      fetch: fetchMock as typeof fetch,
    })

    await expect(client.createToken()).resolves.toEqual({ token: 'new-token' })
    const [input, init] = fetchMock.mock.calls[0]!
    expect(String(input)).toBe('https://spool.pro/api/hub/v1/tokens')
    expect(init).toMatchObject({ method: 'POST' })
    expect(init?.body).toBeUndefined()
  })

  it.each([
    [401, { message: 'invalid token' }, 'invalid token'],
    [404, { error: 'NOT_FOUND', detail: 'session missing' }, 'session missing'],
    [410, { error: 'GONE', detail: 'withdrawn' }, 'withdrawn'],
  ])('throws a typed error for HTTP %s', async (status, body, message) => {
    const fetchMock = vi.fn(async () => new Response(
      typeof body === 'string' ? body : JSON.stringify(body),
      { status },
    ))
    const client = new HubClient({
      hubUrl: 'https://spool.pro',
      token: 'bad-token',
      fetch: fetchMock as typeof fetch,
    })

    const error = await client.withdrawSession(SID).catch(value => value as unknown)
    expect(error).toBeInstanceOf(HubHttpError)
    expect(error).toMatchObject({ status, bodyMessage: message })
  })
})
