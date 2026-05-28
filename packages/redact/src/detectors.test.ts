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
} from './index.js'
import type { SensitiveKind } from './types.js'

const kindsOf = (text: string): SensitiveKind[] =>
  detectSensitiveSpans(text).map((m) => m.kind)

describe('identity', () => {
  it('finds an email and reports its span', () => {
    // Fixture uses a non-reserved domain (the validator drops
    // RFC 2606 example.com / test.com / generic "yourcompany.com").
    const text = 'reply to maya@hogwarts.edu when ready'
    const [m] = detectSensitiveSpans(text)
    expect(m?.kind).toBe('email')
    expect(m?.value).toBe('maya@hogwarts.edu')
    expect(text.slice(m!.start, m!.end)).toBe('maya@hogwarts.edu')
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
  it('does not flag the fractional part of a decimal as a credit card (issue #340)', () => {
    // `5227687358856201` happens to be 16 digits, start with 5
    // (Mastercard prefix), and pass Luhn — but it's the fractional
    // part of a `confidence` float, not a card number.
    expect(kindsOf("[{'label': 'silence', 'confidence': 0.5227687358856201}]")).not.toContain('credit-card')
    expect(kindsOf('score=0.5227687358856201 next')).not.toContain('credit-card')
    // Sanity: a real-looking card right after a period (non-decimal
    // context) is still caught.
    expect(kindsOf('Card. 4111 1111 1111 1111')).toContain('credit-card')
  })
  it('finds a US SSN, rejects reserved area 000/666/9xx', () => {
    expect(kindsOf('SSN 123-45-6789')).toContain('ssn')
    expect(kindsOf('666-45-6789 000-45-6789 900-45-6789')).not.toContain('ssn')
  })
  it('finds IPv4 and IPv6', () => {
    expect(kindsOf('server at 192.168.1.42')).toContain('ip')
    // Real public IPv6 (Google DNS) — not the RFC 3849 documentation
    // range, which the validator now correctly rejects.
    expect(kindsOf('dns 2001:4860:4860:0:0:0:0:8888 today')).toContain('ip')
  })
  it('accepts compressed IPv6 forms with ::', () => {
    expect(kindsOf('cdn 2606:4700:4700::1111 used by Cloudflare')).toContain('ip')
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
    // Real-shape (no EXAMPLE / SAMPLE suffix — those are vendor-doc
    // placeholders the validator now rejects). Split via tok so the
    // source literal doesn't trip GitHub secret scanning.
    const k = tok('AKIA', 'V3QFKW72ZDLNP4XR')
    expect(detectSensitiveSpans(k)[0]?.kind).toBe('api-key')
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
    const accessKey = tok('AKIA', 'V3QFKW72ZDLNP4XR')
    // Avoid the canonical `wJalrXUt…` prefix from AWS docs — the
    // credentialBlockLooksReal validator drops anything containing
    // that literal as a vendor-doc placeholder.
    const secretBody = tok('p7Yz0RbHm6Q+', 'k8L2nVtD3fXgJ', '/W4UeKaPiHsQzCxMlV1y')
    const block = `[default]\naws_access_key_id = ${accessKey}\naws_secret_access_key = ${secretBody}\n`
    const m = detectSensitiveSpans(`cat ~/.aws/credentials\n${block}`)
    expect(m.some((x) => x.kind === 'cloud-cred-ini')).toBe(true)
  })
  it('finds kubeconfig token field', () => {
    // Random-shape body via tok so the source doesn't read as a real
    // secret. Entropy clears the validator floor (≥ 3.0).
    const t = tok('j82H1xK9pQrSt7Vw', 'YzA3bC5dF8gJkL2', 'mNoPqRsT')
    expect(kindsOf(`users:\n- name: admin\n  user:\n    token: ${t}`))
      .toContain('kubeconfig-token')
  })
  it('finds a .netrc line', () => {
    // Avoid `example.com` (reserved domain on emails — same string
    // would slip credentialBlockLooksReal but we still want a
    // realistic shape) and avoid `hunter2` (placeholder).
    const pw = tok('j82H1xK9', 'pQrSt7VwYzA3bC5dF8gJ')
    expect(kindsOf(`machine api.spoollab.io login chen password ${pw}`))
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
    // Drop `test` and `example`-named hosts — both trigger the
    // placeholder filter on the credentialBlockLooksReal validator.
    expect(kindsOf('client = MongoClient("mongodb+srv://u:p@cluster.mongodb.net/main")'))
      .toContain('connection-string')
  })
  it('finds redis URI', () => {
    expect(kindsOf('REDIS_URL=rediss://user:pass@redis.spoollab.io:6380'))
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
    // Avoid `hunter2` (placeholder) and `example.com` (reserved).
    const pw = tok('j82H1xK9', 'pQrSt7VwYzA3')
    expect(kindsOf(`connect to https://admin:${pw}@db.spoollab.io:5432/main`)).toContain('url-creds')
  })
  it('finds an env-var-style assignment', () => {
    // Value must not look like a JS storage-key identifier (pure
    // lowercase letters / underscores < 28 chars), so include a
    // digit + sufficient length.
    const body = tok('sk_', 'live_', 'aH1xK9pQrSt7VwYzA3bC5dF8gJ')
    expect(kindsOf(`STRIPE_SECRET_KEY=${body}`)).toContain('env-var')
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
  it('does not flag PascalCase property chains ending in `.internal` (issue #340)', () => {
    // `SqlParser.internal` is a class/property access in code, not a
    // hostname. The case-sensitive regex (no `/i` flag) rejects it.
    expect(kindsOf('throw new SqlParser.internal.UnexpectedTokenError()')).not.toContain('internal-host')
    expect(kindsOf('AppRouter.internal handles the redirect')).not.toContain('internal-host')
  })
  it('does not flag bundler output filenames like `*.prod.js` (issue #340)', () => {
    // `app-page-turbo.runtime.prod.js` is a webpack/turbo build
    // artifact. The loose `prod\.[a-z0-9]+` tail in the regex
    // matches it; the file-extension validator drops it.
    expect(kindsOf('chunk app-page-turbo.runtime.prod.js loaded')).not.toContain('internal-host')
    expect(kindsOf('failed loading vendor.prod.css')).not.toContain('internal-host')
    expect(kindsOf('see chunk.stg.json for the map')).not.toContain('internal-host')
  })
})

describe('false-positive filters (precision tuning)', () => {
  // Per-rule validators dropping noise that the regex would otherwise
  // happily accept. Each block names the FP class + the assertion.

  describe('placeholder / redaction-marker values', () => {
    for (const text of [
      'API_KEY=xxxx-xxxx-xxxx-xxxx',
      'API_TOKEN=<your-token>',
      'GH_TOKEN=...',
      'DB_PASSWORD=…',
      'API_KEY=[redacted]',
      'MY_SECRET=changeme',
      'cred=letmein',
    ]) {
      it(`drops ${JSON.stringify(text)}`, () => {
        expect(kindsOf(text)).not.toContain('env-var')
      })
    }
  })

  describe('public-by-convention env-var prefixes', () => {
    for (const name of [
      'NEXT_PUBLIC_API_URL',
      'VITE_PUBLIC_KEY',
      'REACT_APP_API_URL',
      'GATSBY_API_URL',
      'EXPO_PUBLIC_API_URL',
    ]) {
      it(`drops ${name} (frameworks bundle these to the client)`, () => {
        expect(kindsOf(`${name}=https://api.spoollab.io/v1`)).not.toContain('env-var')
      })
    }
  })

  describe('non-ASCII placeholder text in env-var values', () => {
    // Real env-var secrets are ASCII; any natural-language non-ASCII
    // content (CJK / Cyrillic / Hangul / emoji) is placeholder
    // description text. See real reports like
    // `AGENT_INTERNAL_SECRET='你自己生成的一串随机密钥'`.
    for (const text of [
      "AGENT_INTERNAL_SECRET='你自己生成的一串随机密钥'",
      "FLY_API_TOKEN='刚才那个开发组织'",
      "DB_PASSWORD='пароль-заглушка'",
      "API_KEY='プレースホルダー'",
      "WEBHOOK_SECRET='🔑🔒💰🔑🔒💰'",
    ]) {
      it(`drops ${JSON.stringify(text)}`, () => {
        expect(kindsOf(text)).not.toContain('env-var')
      })
    }
    it('keeps an ASCII secret of the same length range', () => {
      // Sanity check: the non-ASCII filter must not regress ordinary
      // ASCII tokens — `STRIPE_SECRET_KEY=` test above covers the
      // primary positive, but include a shorter sibling here so a
      // single failure points straight at the new clause.
      const body = tok('sk_', 'live_', 'aH1xK9pQrSt7VwYzA3bC5dF8gJ')
      expect(kindsOf(`OPENAI_API_KEY=${body}`)).toContain('env-var')
    })
  })

  describe('JS const declarations matching env-var shape', () => {
    for (const text of [
      "const LAST_COUNT_KEY = 'spool.shares.skeletonCount'",
      "const STORAGE_KEY = 'spool_theme_editor'",
      "FEATURE_KEY = 'auth.session.id'",
    ]) {
      it(`drops ${JSON.stringify(text)} (storage-key string, not env)`, () => {
        expect(kindsOf(text)).not.toContain('env-var')
      })
    }
  })

  describe('reserved / example domains in emails', () => {
    for (const e of [
      'user@example.com', 'a@example.net', 'b@test.com',
      'c@yourcompany.com', 'd@mydomain.com', 'e@localhost',
    ]) {
      it(`drops ${e}`, () => {
        expect(kindsOf(`mail ${e}`)).not.toContain('email')
      })
    }
  })

  describe('image filenames look like emails', () => {
    for (const f of ['icon_16x16@2x.png', 'badge@3x.jpg', 'header@hires.webp']) {
      it(`drops ${f}`, () => {
        expect(kindsOf(`asset ${f}`)).not.toContain('email')
      })
    }
  })

  describe('reserved IP ranges', () => {
    for (const ip of [
      '127.0.0.1', '127.5.6.7',
      '192.0.2.42', '198.51.100.99', '203.0.113.1',
      '0.0.0.0', '169.254.1.1',
      '2001:0db8:85a3:0000:0000:8a2e:0370:7334',
    ]) {
      it(`drops ${ip} (loopback / docs / link-local)`, () => {
        expect(kindsOf(`addr ${ip} here`)).not.toContain('ip')
      })
    }
  })

  describe('vendor-doc example API keys', () => {
    it('drops AWS docs canonical AKIAIOSFODNN7EXAMPLE', () => {
      // Constructed at runtime so source-level scanner doesn't flag.
      const k = tok('AKIA', 'IOSFODNN7EXAMPLE')
      expect(kindsOf(`key=${k}`)).not.toContain('api-key')
    })
  })

  describe('JS property chains the internal-host regex matches', () => {
    for (const code of ['process.env.HOME', 'import.meta.home']) {
      it(`drops ${code}`, () => {
        expect(kindsOf(`val = ${code}`)).not.toContain('internal-host')
      })
    }
  })

  describe('phone shape false positives', () => {
    it('drops "+0000 2026" (year, no real country code starts with 0)', () => {
      expect(kindsOf('release +0000 2026 today')).not.toContain('phone')
    })
  })

  describe('connection-string / url-creds containing redaction markers', () => {
    for (const text of [
      'connect postgres://user:[SECRET:password]@host/db',
      'redis URI: rediss://[redacted]@cache.spoollab.io:6380',
      'mongo mongodb://admin:…@cluster.spoollab.io/main',
      'plain https://[redacted:redacted]@db.spoollab.io',
    ]) {
      it(`drops ${JSON.stringify(text)}`, () => {
        const kinds = kindsOf(text)
        expect(kinds).not.toContain('connection-string')
        expect(kinds).not.toContain('url-creds')
      })
    }
  })

  describe('kubeconfig token is a low-entropy placeholder', () => {
    it('drops alphabet-sequence token', () => {
      expect(kindsOf('token: abcdefghijklmnopqrstuvwxyz'))
        .not.toContain('kubeconfig-token')
    })
  })
})

describe('general behaviour', () => {
  it('does not flag plain prose', () => {
    expect(detectSensitiveSpans('The cache TTL is five minutes.')).toEqual([])
  })
  it('orders matches by start position', () => {
    const apiKey = tok('sk-', '12abcdefghij1234567890', 'ABCDEFGHIJklmnopqr')
    const matches = detectSensitiveSpans(
      `first: maya@hogwarts.edu, then key ${apiKey}`,
    )
    expect(matches.length).toBeGreaterThanOrEqual(2)
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i]!.start).toBeGreaterThanOrEqual(matches[i - 1]!.start)
    }
  })
  it('does not loop forever on dense repeated content', () => {
    const k = tok('AKIA', 'V3QFKW72ZDLNP4XR')
    const text = ('a@b.co '.repeat(100) + `${k} `).repeat(10)
    expect(detectSensitiveSpans(text).length).toBeGreaterThan(0)
  })
  it('attaches confidence + provider to every match', () => {
    const k = tok('AKIA', 'V3QFKW72ZDLNP4XR')
    const matches = detectSensitiveSpans(`email maya@hogwarts.edu and ${k}`)
    for (const m of matches) {
      expect(m.confidence).toBeGreaterThan(0)
      expect(m.confidence).toBeLessThanOrEqual(1)
      expect(m.provider).toBe('regex')
    }
  })
})

describe('groupBySensitiveKind', () => {
  it('groups matches by kind with distinct values in detection order', () => {
    const k = tok('AKIA', 'V3QFKW72ZDLNP4XR')
    const text = [
      'a@one.io', 'b@two.io', 'c@three.io', 'd@four.io', k,
    ].join(' ')
    const groups = groupBySensitiveKind(detectSensitiveSpans(text))
    const emailGroup = groups.find((g) => g.kind === 'email')
    expect(emailGroup?.count).toBe(4)
    expect(emailGroup?.values.map((v) => v.value)).toEqual([
      'a@one.io', 'b@two.io', 'c@three.io', 'd@four.io',
    ])
    expect(emailGroup?.values.every((v) => v.count === 1)).toBe(true)
    expect(groups.find((g) => g.kind === 'api-key')?.count).toBe(1)
  })

  it('dedupes repeated literals and counts occurrences', () => {
    const a = tok('AKIA', 'V3QFKW72ZDLNP4XR')
    const b = tok('ASIA', '7CNPXJWLKMNRBV9Q')
    const text = `first ${a}, again ${a}, plus ${b}`
    const groups = groupBySensitiveKind(detectSensitiveSpans(text))
    const apiGroup = groups.find((g) => g.kind === 'api-key')
    expect(apiGroup?.count).toBe(3)
    expect(apiGroup?.values).toHaveLength(2)
    expect(apiGroup?.values[0]).toEqual({ value: a, count: 2 })
    expect(apiGroup?.values[1]).toEqual({ value: b, count: 1 })
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
    const matches = await regexProvider.analyze('email maya@hogwarts.edu')
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
