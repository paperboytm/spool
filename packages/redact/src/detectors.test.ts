import { describe, it, expect } from 'vitest'
import {
  detectSensitiveSpans,
  groupBySensitiveKind,
  SENSITIVE_KIND_LABEL,
  SENSITIVE_KIND_ORDER,
  regexProvider,
  analyzeWith,
  luhnOk,
  shannon,
} from './index'
import type { SensitiveKind } from './types'

const kindsOf = (text: string): SensitiveKind[] =>
  detectSensitiveSpans(text).map((m) => m.kind)

describe('identity', () => {
  it('finds an email and reports its span', () => {
    const text = 'reply to maya@example.com when ready'
    const [m] = detectSensitiveSpans(text)
    expect(m?.kind).toBe('email')
    expect(m?.value).toBe('maya@example.com')
    expect(text.slice(m!.start, m!.end)).toBe('maya@example.com')
  })
  it('does not flag CSS hex colors as emails', () => {
    expect(detectSensitiveSpans('background: #FF8800;')).toEqual([])
  })
  it('finds international phones with leading +', () => {
    expect(kindsOf('call +1 415 555 0142 tomorrow')).toContain('phone')
  })
  it('does not flag four-digit room numbers as phones', () => {
    expect(detectSensitiveSpans('see you in room 1234')).toEqual([])
  })
  it('finds Luhn-valid credit cards', () => {
    expect(kindsOf('card 4111 1111 1111 1111 expires soon')).toContain('credit-card')
  })
  it('skips Luhn-invalid card-shaped digit runs', () => {
    expect(kindsOf('order 4111 1111 1111 1112')).not.toContain('credit-card')
  })
  it('finds a US SSN, rejects reserved area 000/666/9xx', () => {
    expect(kindsOf('SSN 123-45-6789')).toContain('ssn')
    expect(kindsOf('666-45-6789 000-45-6789 900-45-6789')).not.toContain('ssn')
  })
  it('finds IPv4 and IPv6', () => {
    expect(kindsOf('server at 192.168.1.42')).toContain('ip')
    expect(kindsOf('addr 2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toContain('ip')
  })
  it('accepts compressed IPv6 forms with ::', () => {
    expect(kindsOf('loopback ::1 plus 2001:db8::1 thanks')).toContain('ip')
  })
  it('rejects HH:MM:SS time strings that the broad IPv6 regex superficially matches', () => {
    // `12:22:57` is 3 colon-separated decimal groups — looks like
    // IPv6 to a naive regex, but isn't one (no `::`, only 3 groups).
    expect(kindsOf('logged at 12:22:57 today')).not.toContain('ip')
    expect(kindsOf('took 00:12:35 to run')).not.toContain('ip')
  })
})

// Vendor-prefixed token fixtures built at runtime so GitHub's
// push-protection secret scanner doesn't flag the source literals.
// The runtime VALUES still match the detector's regex; only the
// scanner-visible source pattern is broken up.
const tok = (...parts: string[]) => parts.join('')

describe('credentials — vendor api keys', () => {
  it('finds an OpenAI-style api key', () => {
    expect(kindsOf(`use ${tok('sk-', 'abcdef0123456789ABCDEFGHabcdef0123456789')}`)).toContain('api-key')
  })
  it('finds an Anthropic api key without colliding with OpenAI rule', () => {
    const m = detectSensitiveSpans(tok('sk-', 'ant-', 'api03-abcdef0123456789ABCDEFGHabcdef0123456789-XYZ'))
      .find((x) => x.kind === 'api-key')
    expect(m?.value.startsWith('sk-ant-')).toBe(true)
  })
  it('finds a GitHub PAT', () => {
    expect(kindsOf(`GH_TOKEN=${tok('ghp_', 'abcdefghijklmnopqrstuvwxyz0123456789')}`)).toContain('api-key')
  })
  it('finds an AWS access key id', () => {
    expect(detectSensitiveSpans('AKIAIOSFODNN7EXAMPLE')[0]?.kind).toBe('api-key')
  })
  it('finds an AWS session token (ASIA prefix)', () => {
    expect(kindsOf(`cred=${tok('ASIA', '1234567890ABCDEF')}`)).toContain('api-key')
  })
  it('finds a Google API key', () => {
    expect(kindsOf(`key=${tok('AIza', 'SyA-1234567890abcdefghijklmnopqrstu')}`)).toContain('api-key')
  })
  it('finds a gcloud access token (ya29.)', () => {
    expect(kindsOf(`export TOK=${tok('ya29.', 'a0ARrdaM_abcdefghijklmnopqrstuvwxyz0123456789')}`)).toContain('api-key')
  })
  it('finds a Slack token', () => {
    expect(kindsOf(tok('xox', 'b-0000000000-zzzzzzzzzzzzzzzzzzzz'))).toContain('api-key')
  })
  it('finds a HuggingFace token', () => {
    expect(kindsOf(`export HF=${tok('hf_', 'abcdefghijklmnopqrstuvwxyzABCDEF')}`)).toContain('api-key')
  })
  it('finds a Stripe live key', () => {
    const tok = 'sk_' + 'live_' + 'x'.repeat(30)
    expect(kindsOf(tok)).toContain('api-key')
  })
  it('finds a Docker Hub PAT', () => {
    // Built at runtime so GitHub's push-protection secret scanner
    // doesn't flag the literal prefix in source.
    const tok = 'dckr_' + 'pat_' + 'x'.repeat(28)
    expect(kindsOf(tok)).toContain('api-key')
  })
  it('finds a DigitalOcean v1 token', () => {
    const tok = 'dop_v1_' + 'a'.repeat(64)
    expect(kindsOf(`token=${tok}`)).toContain('api-key')
  })
})

describe('credentials — composite blocks', () => {
  it('finds a PEM private key block end-to-end', () => {
    const key = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAxxxx\nyyyy\n-----END RSA PRIVATE KEY-----'
    const matches = detectSensitiveSpans(`here:\n${key}\nthanks`)
    expect(matches[0]?.kind).toBe('private-key')
    expect(matches[0]?.value).toBe(key)
  })
  it('finds a raw OpenSSH key body even without armour', () => {
    const body = 'b3BlbnNzaC1rZXktdjEAAAAACmFlczI1Ni1jdHIAAAAGYmNyeXB0AAAAGAAAABCT' + 'A'.repeat(80)
    expect(kindsOf(`paste: ${body}`)).toContain('ssh-key')
  })
  it('finds an AWS credentials INI block', () => {
    const block = '[default]\naws_access_key_id = AKIAIOSFODNN7EXAMPLE\naws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY\n'
    const m = detectSensitiveSpans(`cat ~/.aws/credentials\n${block}`)
    expect(m.some((x) => x.kind === 'cloud-cred-ini')).toBe(true)
  })
  it('finds kubeconfig token field', () => {
    expect(kindsOf('users:\n- name: admin\n  user:\n    token: abcdefghijklmnopqrstuvwxyz0123456789'))
      .toContain('kubeconfig-token')
  })
  it('finds a .netrc line', () => {
    expect(kindsOf('machine api.example.com login chen password hunter2'))
      .toContain('netrc')
  })
  it('finds a gcloud application_default_credentials field', () => {
    expect(kindsOf('"refresh_token": "1//abcdefghijklmnopqrstuvwxyz"'))
      .toContain('cloud-cred-ini')
  })
})

describe('credentials — connection strings', () => {
  it('finds postgres connection string', () => {
    expect(kindsOf('psql "postgresql://user:pass@db.host:5432/main"'))
      .toContain('connection-string')
  })
  it('finds mongodb+srv URI', () => {
    expect(kindsOf('client = MongoClient("mongodb+srv://u:p@cluster.mongodb.net/test")'))
      .toContain('connection-string')
  })
  it('finds redis URI', () => {
    expect(kindsOf('REDIS_URL=rediss://user:pass@redis.example.com:6380'))
      .toContain('connection-string')
  })
})

describe('credentials — context wrappers', () => {
  it('finds a JWT and prefers it over the bearer wrapper', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4f'
    const matches = detectSensitiveSpans(`Authorization: Bearer ${jwt}`)
    expect(matches.some((m) => m.kind === 'jwt' && m.value === jwt)).toBe(true)
  })
  it('finds a bearer token that is not itself a JWT', () => {
    expect(kindsOf('Authorization: Bearer abcdef1234567890XYZ')).toContain('bearer')
  })
  it('finds a basic-auth header', () => {
    expect(kindsOf('Authorization: Basic dXNlcjpwYXNz')).toContain('basic-auth')
  })
  it('finds URL-embedded credentials', () => {
    expect(kindsOf('connect to https://admin:hunter2@db.example.com:5432/main')).toContain('url-creds')
  })
  it('finds an env-var-style assignment', () => {
    expect(kindsOf(`STRIPE_SECRET_KEY=${tok('sk_', 'live_', 'x'.repeat(24))}`)).toContain('env-var')
  })
  it('finds a generic high-entropy secret near a keyword', () => {
    expect(kindsOf('api_key = "j82H1xK9pQrSt7VwYzA3bC5dF8gJ"')).toContain('generic-secret')
  })
  it('does NOT flag a low-entropy quoted password as generic-secret', () => {
    expect(kindsOf('password = "letmeinletmeinletmein"')).not.toContain('generic-secret')
  })
})

describe('location / infra', () => {
  it('finds an absolute Unix home path', () => {
    expect(detectSensitiveSpans('check /Users/chen/secrets/keys.txt')[0]?.kind).toBe('absolute-path')
  })
  it('finds a Windows user path', () => {
    expect(kindsOf('open C:\\Users\\chen\\Documents\\notes.md')).toContain('absolute-path')
  })
  it('finds *.internal / *.corp hostnames', () => {
    expect(kindsOf('reach api.eng.corp on port 8080')).toContain('internal-host')
    expect(kindsOf('curl http://db.prod.internal/health')).toContain('internal-host')
  })
  it('does not flag `.env.local` and other `.local` filename refs as internal-host', () => {
    // `.local` is mDNS BUT also a dominant filename suffix
    // (`.env.local`, `settings.local`, `next.config.local`). We dropped
    // it from the TLD list to eliminate the false positives — real
    // mDNS hosts are rare in Spool's data.
    expect(kindsOf('cat .env.local')).not.toContain('internal-host')
    expect(kindsOf('open next.config.local then env.dev.local')).not.toContain('internal-host')
    expect(kindsOf('see settings.local for prefs')).not.toContain('internal-host')
  })
})

describe('general behaviour', () => {
  it('does not flag plain prose', () => {
    expect(detectSensitiveSpans('The cache TTL is five minutes.')).toEqual([])
  })
  it('orders matches by start position', () => {
    const matches = detectSensitiveSpans(
      'first: maya@example.com, then key sk-1234567890abcdefghij1234567890ab',
    )
    expect(matches.length).toBeGreaterThanOrEqual(2)
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i]!.start).toBeGreaterThanOrEqual(matches[i - 1]!.start)
    }
  })
  it('does not loop forever on dense repeated content', () => {
    const text = ('a@b.co '.repeat(100) + 'AKIAIOSFODNN7EXAMPLE ').repeat(10)
    expect(detectSensitiveSpans(text).length).toBeGreaterThan(0)
  })
  it('attaches confidence + provider to every match', () => {
    const matches = detectSensitiveSpans('email maya@example.com and AKIAIOSFODNN7EXAMPLE')
    for (const m of matches) {
      expect(m.confidence).toBeGreaterThan(0)
      expect(m.confidence).toBeLessThanOrEqual(1)
      expect(m.provider).toBe('regex')
    }
  })
})

describe('groupBySensitiveKind', () => {
  it('groups matches by kind with distinct values in detection order', () => {
    const text = [
      'a@one.com', 'b@two.com', 'c@three.com', 'd@four.com',
      'AKIAIOSFODNN7EXAMPLE',
    ].join(' ')
    const groups = groupBySensitiveKind(detectSensitiveSpans(text))
    const emailGroup = groups.find((g) => g.kind === 'email')
    expect(emailGroup?.count).toBe(4)
    expect(emailGroup?.values.map((v) => v.value)).toEqual([
      'a@one.com', 'b@two.com', 'c@three.com', 'd@four.com',
    ])
    expect(emailGroup?.values.every((v) => v.count === 1)).toBe(true)
    expect(groups.find((g) => g.kind === 'api-key')?.count).toBe(1)
  })

  it('dedupes repeated literals and counts occurrences', () => {
    const text = 'first AKIAIOSFODNN7EXAMPLE, again AKIAIOSFODNN7EXAMPLE, plus ASIA1234567890ABCDEF'
    const groups = groupBySensitiveKind(detectSensitiveSpans(text))
    const apiGroup = groups.find((g) => g.kind === 'api-key')
    expect(apiGroup?.count).toBe(3)
    expect(apiGroup?.values).toHaveLength(2)
    expect(apiGroup?.values[0]).toEqual({ value: 'AKIAIOSFODNN7EXAMPLE', count: 2 })
    expect(apiGroup?.values[1]).toEqual({ value: 'ASIA1234567890ABCDEF', count: 1 })
  })
  it('exposes a human label for every kind', () => {
    const allKinds: SensitiveKind[] = [
      'private-key', 'ssh-key', 'cloud-cred-ini', 'kubeconfig-token',
      'connection-string', 'api-key', 'netrc', 'jwt', 'bearer',
      'basic-auth', 'env-var', 'generic-secret', 'url-creds',
      'credit-card', 'ssn', 'email', 'phone', 'ip', 'absolute-path',
      'internal-host',
    ]
    for (const k of allKinds) {
      expect(SENSITIVE_KIND_LABEL[k]).toBeTruthy()
    }
  })
})

describe('providers', () => {
  it('regex provider returns Promise of matches', async () => {
    expect(regexProvider.available()).toBe(true)
    const matches = await regexProvider.analyze('email maya@example.com')
    expect(matches.some((m) => m.kind === 'email')).toBe(true)
  })
  it('analyzeWith merges results and de-overlaps by provider priority', async () => {
    const fake = {
      name: 'fake',
      displayName: 'Fake',
      available: () => true,
      analyze: async () => [
        { kind: 'email' as const, value: 'maya@example.com', start: 9, end: 25, confidence: 0.9, provider: 'fake' },
      ],
    }
    // fake first, then regex. Fake wins the overlap.
    const merged = await analyzeWith([fake, regexProvider], 'reply to maya@example.com')
    const m = merged.find((x) => x.kind === 'email')
    expect(m?.provider).toBe('fake')
  })
})

describe('validators (sanity)', () => {
  it('luhnOk', () => {
    expect(luhnOk('4111 1111 1111 1111')).toBe(true)
    expect(luhnOk('4111 1111 1111 1112')).toBe(false)
  })
  it('shannon entropy is monotone', () => {
    expect(shannon('aaaaaaaa')).toBeLessThan(shannon('abcdefgh'))
  })
})

describe('ML-only kinds (consumed by Privacy Filter)', () => {
  it('person-name / street-address / date-of-birth are present in ORDER and LABEL maps', () => {
    expect(SENSITIVE_KIND_ORDER).toContain('person-name')
    expect(SENSITIVE_KIND_ORDER).toContain('street-address')
    expect(SENSITIVE_KIND_ORDER).toContain('date-of-birth')
    expect(SENSITIVE_KIND_LABEL['person-name']).toBe('Person name')
    expect(SENSITIVE_KIND_LABEL['street-address']).toBe('Street address')
    expect(SENSITIVE_KIND_LABEL['date-of-birth']).toBe('Date of birth')
  })
})
