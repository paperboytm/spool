import { describe, it, expect } from 'vitest'
import { rotationUrlForVendor, rotationUrlForToken } from './rotation.js'

describe('rotationUrlForVendor', () => {
  it('maps verified vendors to their exact official rotation URL', () => {
    expect(rotationUrlForVendor('AWS')).toBe('https://console.aws.amazon.com/iam/home#/security_credentials')
    expect(rotationUrlForVendor('GitHub')).toBe('https://github.com/settings/tokens')
    expect(rotationUrlForVendor('OpenAI')).toBe('https://platform.openai.com/api-keys')
    expect(rotationUrlForVendor('Anthropic')).toBe('https://console.anthropic.com/settings/keys')
    expect(rotationUrlForVendor('Stripe')).toBe('https://dashboard.stripe.com/apikeys')
    expect(rotationUrlForVendor('Hugging Face')).toBe('https://huggingface.co/settings/tokens')
    expect(rotationUrlForVendor('Google')).toBe('https://console.cloud.google.com/apis/credentials')
    expect(rotationUrlForVendor('Slack')).toBe('https://api.slack.com/apps')
    expect(rotationUrlForVendor('GitLab')).toBe('https://gitlab.com/-/user_settings/personal_access_tokens')
    expect(rotationUrlForVendor('npm')).toBe('https://www.npmjs.com/settings/~/tokens')
  })

  it('returns null for vendors we recognise but have no verified URL for', () => {
    // detectVendor knows these, but no stable self-service URL → omitted.
    expect(rotationUrlForVendor('Mailgun')).toBeNull()
    expect(rotationUrlForVendor('Square')).toBeNull()
    expect(rotationUrlForVendor('Databricks')).toBeNull()
  })

  it('returns null for an unknown vendor and for null', () => {
    expect(rotationUrlForVendor('Nonexistent')).toBeNull()
    expect(rotationUrlForVendor(null)).toBeNull()
  })

  it('every URL is https and well-formed', () => {
    for (const vendor of ['AWS', 'GitHub', 'OpenAI', 'Anthropic', 'Stripe', 'Hugging Face', 'Google', 'Slack', 'GitLab', 'npm', 'DigitalOcean', 'Vercel', 'Cloudflare', 'Twilio', 'SendGrid', 'Docker Hub', 'PyPI']) {
      const url = rotationUrlForVendor(vendor)
      expect(url, vendor).toBeTruthy()
      expect(() => new URL(url!)).not.toThrow()
      expect(url!.startsWith('https://')).toBe(true)
    }
  })
})

describe('rotationUrlForToken', () => {
  it('resolves vendor from a token prefix then maps to URL', () => {
    expect(rotationUrlForToken('ghp_' + 'a'.repeat(36))).toBe('https://github.com/settings/tokens')
    expect(rotationUrlForToken('sk-ant-api03-xyz')).toBe('https://console.anthropic.com/settings/keys')
    expect(rotationUrlForToken('AKIAIOSFODNN7EXAMPLE')).toBe('https://console.aws.amazon.com/iam/home#/security_credentials')
    expect(rotationUrlForToken('sk_live_' + 'x'.repeat(24))).toBe('https://dashboard.stripe.com/apikeys')
  })

  it('returns null when the token prefix is unrecognised', () => {
    expect(rotationUrlForToken('zzz-unknown-prefix-abc123')).toBeNull()
  })
})
