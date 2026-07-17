import type { HubClient, HubRecord } from './client.js'

// Range-fetch helpers over the hub records endpoint. The server may
// return fewer lines than requested (byte cap) — continuation always
// resumes from the last received index + 1.

export async function fetchRecordsExact(
  client: HubClient,
  sid: string,
  from: number,
  to: number,
): Promise<HubRecord[]> {
  const records: HubRecord[] = []
  let cursor = from
  while (cursor < to) {
    let progressed = false
    for await (const record of client.getSessionRecords(sid, { from: cursor, to })) {
      records.push(record)
      progressed = true
    }
    if (!progressed) throw new Error(`Hub returned no records for range ${cursor}..${to}`)
    cursor = (records[records.length - 1] as HubRecord).i + 1
  }
  return records
}

/**
 * Fetch exactly the records named by `indices`, bridging gaps of up to
 * `maxGap` skipped records — one slightly-wider request beats many
 * small ones. Mirrors share-web's batching so CLI and reader behave
 * identically.
 */
export async function fetchRecordsByIndices(
  client: HubClient,
  sid: string,
  indices: readonly number[],
  maxGap = 8,
): Promise<HubRecord[]> {
  if (indices.length === 0) return []
  const sorted = [...new Set(indices)].sort((a, b) => a - b)
  const wanted = new Set(sorted)
  const out: HubRecord[] = []

  let start = sorted[0] as number
  let end = start + 1
  const flush = async () => {
    const records = await fetchRecordsExact(client, sid, start, end)
    for (const record of records) {
      if (wanted.has(record.i)) out.push(record)
    }
  }
  for (const index of sorted.slice(1)) {
    if (index < end + maxGap) {
      end = index + 1
    } else {
      await flush()
      start = index
      end = index + 1
    }
  }
  await flush()
  return out
}
