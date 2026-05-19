// Fixture conversation used as an empty-state fallback in the Editor
// (when no draft is saved and no handoff is in flight).

import type { Conversation } from './types'

export const FIXTURE_PASTED: Conversation = {
  source: 'claude',
  sourceLabel: 'Claude',
  origin: {
    kind: 'web-share',
    platform: 'Claude',
    url: 'https://claude.ai/share/8f3a2e1b-d4c7-4a90-b3f2-1e9c7a0d5f8b',
  },
  title: 'Debugging a race condition in the cache layer',
  shareUrl: 'https://claude.ai/share/8f3a2e1b-d4c7-4a90-b3f2-1e9c7a0d5f8b',
  shortUrl: 'spool.pro/s/3fm2',
  createdAt: 'April 18, 2026',
  wordCount: 3412,
  readMin: 6,
  turns: [
    {
      role: 'user',
      author: '[Maya]',
      body: `Something weird — we're seeing stale reads from our user-prefs cache about once every forty requests, but only under load. Fresh writes look fine in isolation. I've stared at this for two hours.`,
    },
    {
      role: 'assistant',
      body: `That frequency suggests a race, not a correctness bug in the logic. A few questions before we guess:

  1. Is the cache populated on read-miss, or only written by the service that owns the preference?
  2. Do reads acquire any lock, or do they go straight to the store?
  3. What's the TTL, and is the TTL applied at write time or at first-read time?`,
    },
    {
      role: 'user',
      author: '[Maya]',
      body: `(1) Both — we lazy-populate on miss, and the prefs service writes through on change. (2) Reads are lock-free. (3) TTL 5 min, applied at write time.`,
    },
    {
      role: 'assistant',
      body: `Good. Then the suspect is the lazy-populate path racing with a through-write. The sequence that produces your stale read looks like this:

  T0  Reader A misses, begins loading from the source of truth.
  T1  Writer W commits a new value to the source of truth.
  T2  Writer W writes through to the cache. Fresh.
  T3  Reader A returns from the source of truth with the OLD value
      it fetched at T0, and — critically — populates the cache.
  T4  Every reader now sees A's stale value until TTL expires.

One bad read poisons the cache for five minutes. That matches your "one in forty, then fine" pattern if load is bursty.`,
    },
    {
      role: 'user',
      author: '[Maya]',
      redact: ['maya@example.co'],
      body: `Oh. Oh no. That's exactly it. We saw a cluster of reports from [maya@example.co] and a handful of teammates in the same five-minute window last Friday and couldn't reproduce after.`,
    },
    {
      role: 'assistant',
      body: `The fix is a version stamp or a compare-and-swap on the populate path. The simplest version:

  • Every write to the source of truth increments a monotonic version.
  • Reader A's populate call does SETNX-style: only populate if the
    cached version is ≤ the version A observed when it started loading.
  • Writer W's write-through is unconditional — it always wins.

This is small and avoids locking the read path.`,
    },
    {
      role: 'user',
      author: '[Maya]',
      body: `Does this change anything about the TTL?`,
    },
    {
      role: 'assistant',
      body: `No — TTL is orthogonal. But while you're in there: consider applying TTL at read time too, as a defense in depth. If a lazy populate ever slips through again, the poisoning window shrinks to one TTL instead of five minutes from the bad write.`,
    },
  ],
}
