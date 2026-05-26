// Vendor → rotation deep-link registry.
//
// When a detected credential resolves to a known vendor, the Security
// surfaces offer a "Rotate this key ↗" affordance that opens the
// vendor's own key-management page. Rotating at the SOURCE is the only
// action that actually closes the leak — Spool's purge merely masks
// its own copy.
//
// URLs drift, so every entry below was verified against the vendor's
// current official docs (see the inline source on each line). Any
// vendor `detectVendor` recognises but for which no stable, verified
// self-service rotation URL exists is deliberately OMITTED — the
// caller then falls back to the generic rotate-reminder text rather
// than shipping a guessed (and likely wrong) link.

import { detectVendor } from './mask.js'

export { detectVendor }

/** Map a vendor name (as returned by {@link detectVendor}) to the
 *  vendor's official key-management / rotation page. Returns null when
 *  we don't have a verified URL for that vendor — the caller falls
 *  back to the plain rotate reminder. */
export function rotationUrlForVendor(vendor: string | null): string | null {
  if (!vendor) return null
  return ROTATION_URLS[vendor] ?? null
}

/** Convenience: resolve the rotation URL directly from a raw token,
 *  combining {@link detectVendor} + {@link rotationUrlForVendor}.
 *  Returns null when the vendor is unknown or has no verified URL. */
export function rotationUrlForToken(token: string): string | null {
  return rotationUrlForVendor(detectVendor(token))
}

// Verified 2026-05-26 against each vendor's official docs / console.
const ROTATION_URLS: Record<string, string> = {
  // docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html
  // → IAM console, user "Security credentials" tab (self-managed keys).
  AWS: 'https://console.aws.amazon.com/iam/home#/security_credentials',
  // docs.github.com/.../managing-your-personal-access-tokens → github.com/settings/tokens
  GitHub: 'https://github.com/settings/tokens',
  // help.openai.com "Where do I find my OpenAI API Key" → platform.openai.com/api-keys
  OpenAI: 'https://platform.openai.com/api-keys',
  // Anthropic Console → Settings → API keys (console.anthropic.com/settings/keys)
  Anthropic: 'https://console.anthropic.com/settings/keys',
  // docs.stripe.com/keys → live-mode API keys tab (dashboard.stripe.com/apikeys)
  Stripe: 'https://dashboard.stripe.com/apikeys',
  // huggingface.co/docs/hub/security-tokens → huggingface.co/settings/tokens
  'Hugging Face': 'https://huggingface.co/settings/tokens',
  // cloud.google.com/docs/authentication/api-keys → APIs & Services → Credentials
  Google: 'https://console.cloud.google.com/apis/credentials',
  // api.slack.com/apps → Slack "Your Apps" (OAuth & Permissions per app)
  Slack: 'https://api.slack.com/apps',
  // docs.gitlab.com/user/profile/personal_access_tokens/ → User settings → Access tokens
  GitLab: 'https://gitlab.com/-/user_settings/personal_access_tokens',
  // docs.npmjs.com/creating-and-viewing-access-tokens. `~` is npm's
  // username placeholder → resolves to the logged-in user's tokens page.
  // Plain `/settings` lands on the unrelated "settings" PACKAGE.
  npm: 'https://www.npmjs.com/settings/~/tokens',
  // docs.digitalocean.com/reference/api/create-personal-access-token/
  DigitalOcean: 'https://cloud.digitalocean.com/account/api/tokens',
  // vercel.com/kb/guide/how-do-i-use-a-vercel-api-access-token → vercel.com/account/tokens
  Vercel: 'https://vercel.com/account/tokens',
  // developers.cloudflare.com/fundamentals/api/get-started/create-token/ → My Profile → API Tokens
  Cloudflare: 'https://dash.cloudflare.com/profile/api-tokens',
  // twilio.com/docs/iam/api-keys/keys-in-console → Console API keys page
  Twilio: 'https://console.twilio.com/us1/account/keys-credentials/api-keys',
  // twilio.com/docs/sendgrid/ui/account-and-settings/api-keys → app.sendgrid.com/settings/api_keys
  SendGrid: 'https://app.sendgrid.com/settings/api_keys',
  // docs.docker.com/security/access-tokens/ → Account settings → Personal access tokens
  'Docker Hub': 'https://app.docker.com/settings/personal-access-tokens',
  // pypi.org/help/#apitoken → Account settings → API tokens
  PyPI: 'https://pypi.org/manage/account/token/',
  // OMITTED (no stable verified self-service URL): Mailgun, Square,
  // Databricks (per-workspace host). detectVendor still recognises
  // them for masking; rotation falls back to the reminder text.
}
