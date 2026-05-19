import { describe, it, expect } from 'vitest'
import { maskValueByKind } from './mask'

describe('maskValueByKind', () => {
  it('email preserves the first character of the local part and the domain', () => {
    expect(maskValueByKind('maya@example.com', 'email')).toBe('m***@example.com')
  })
  it('credit-card preserves the last four digits in the canonical 4-4-4-4 grouping', () => {
    expect(maskValueByKind('4111 1111 1111 1111', 'credit-card')).toBe('**** **** **** 1111')
    expect(maskValueByKind('4111-1111-1111-1111', 'credit-card')).toBe('**** **** **** 1111')
  })
  it('ssn preserves the last four digits', () => {
    expect(maskValueByKind('123-45-6789', 'ssn')).toBe('***-**-6789')
  })
  it('api-key identifies the vendor when the prefix is recognised', () => {
    expect(maskValueByKind('sk_' + 'live_' + 'x'.repeat(24), 'api-key')).toBe('[redacted: Stripe key]')
    expect(maskValueByKind('AKIAIOSFODNN7EXAMPLE', 'api-key')).toBe('[redacted: AWS key]')
    expect(maskValueByKind('ghp_' + 'abcdefghijklmnopqrstuvwxyz0123456789', 'api-key')).toBe('[redacted: GitHub key]')
    expect(maskValueByKind('sk-ant-api03-xyz', 'api-key')).toBe('[redacted: Anthropic key]')
    expect(maskValueByKind('hf_abc', 'api-key')).toBe('[redacted: Hugging Face key]')
  })
  it('api-key falls back to generic when prefix is unknown', () => {
    expect(maskValueByKind('zzz-unknown-prefix-abc123', 'api-key')).toBe('[redacted API key]')
  })
  it('connection-string preserves the scheme', () => {
    expect(maskValueByKind('postgresql://user:pass@host/db', 'connection-string'))
      .toBe('postgresql://[redacted]')
    expect(maskValueByKind('mongodb+srv://u:p@cluster.mongodb.net/test', 'connection-string'))
      .toBe('mongodb+srv://[redacted]')
  })
  it('url-creds preserves scheme + host but masks userinfo', () => {
    expect(maskValueByKind('https://admin:hunter2@db.example.com:5432/main', 'url-creds'))
      .toBe('https://[redacted:redacted]@db.example.com:5432/main')
  })
  it('env-var preserves the NAME but masks the VALUE', () => {
    expect(maskValueByKind('STRIPE_SECRET_KEY=' + 'sk_' + 'live_' + 'xxxx', 'env-var')).toBe('STRIPE_SECRET_KEY=[redacted]')
  })
  it('private-key includes the original byte size as a hint', () => {
    const key = '-'.repeat(1500)
    expect(maskValueByKind(key, 'private-key')).toBe('[redacted private key · 1.5 KB]')
  })
  it('jwt / bearer / basic-auth get distinctive labels', () => {
    expect(maskValueByKind('eyJxxx.yyy.zzz', 'jwt')).toBe('[redacted JWT]')
    expect(maskValueByKind('Bearer abc', 'bearer')).toBe('Bearer [redacted]')
    expect(maskValueByKind('Basic abc', 'basic-auth')).toBe('Basic [redacted]')
  })
  it('cloud-cred-ini detects AWS vs Google by content', () => {
    expect(maskValueByKind('aws_access_key_id = AKIAIOSFODNN7EXAMPLE', 'cloud-cred-ini'))
      .toBe('[redacted AWS credentials]')
    expect(maskValueByKind('"refresh_token": "1//abc"', 'cloud-cred-ini'))
      .toBe('[redacted Google credentials]')
  })
  it('absolute-path preserves the root segment', () => {
    expect(maskValueByKind('/Users/chen/secrets/keys.txt', 'absolute-path')).toBe('/Users/[redacted]')
    expect(maskValueByKind('C:\\Users\\chen\\Documents\\x', 'absolute-path')).toBe('C:\\Users\\[redacted]')
  })
  it('ip preserves the IPv4-vs-IPv6 distinction', () => {
    expect(maskValueByKind('192.168.1.42', 'ip')).toBe('[redacted IPv4]')
    expect(maskValueByKind('2001:0db8::1', 'ip')).toBe('[redacted IPv6]')
  })
  it('internal-host preserves the internal TLD', () => {
    expect(maskValueByKind('api.eng.corp', 'internal-host')).toBe('[redacted].eng.corp')
    expect(maskValueByKind('db.prod.internal', 'internal-host')).toBe('[redacted].prod.internal')
  })
  it('synthetic kinds get a sensible default', () => {
    expect(maskValueByKind('Maya', 'synthetic:author')).toBe('[redacted name]')
    expect(maskValueByKind('custom-blob', 'synthetic:manual')).toBe('[redacted]')
  })
  it('person-name uses generic name mask', () => {
    expect(maskValueByKind('John Smith', 'person-name')).toBe('[redacted name]')
  })
  it('street-address uses generic address mask', () => {
    expect(maskValueByKind('123 Main St', 'street-address')).toBe('[redacted address]')
  })
  it('date-of-birth uses generic DOB mask', () => {
    expect(maskValueByKind('1990-05-15', 'date-of-birth')).toBe('[redacted DOB]')
  })
})
