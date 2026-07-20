// Terms of service — static legal page. Keep every service and content
// claim aligned with the publishing, visibility, withdrawal, and account
// behavior implemented by spool.pro.

import { useEffect } from 'react'

import { Footer, Header, Page } from '../components/Chrome'

const LAST_UPDATED = 'July 20, 2026'

export function Terms() {
  useEffect(() => {
    document.title = 'Terms · spool.pro'
  }, [])

  return (
    <Page>
      <Header />
      <main className="sw-main">
        <article className="sw-card sw-legal w-600">
          <p className="sw-eyebrow">spool.pro</p>
          <h1 className="sw-title">Terms of service</h1>
          <p className="sw-legal-date">Last updated: {LAST_UPDATED}</p>

          <p>
            These terms cover spool.pro and its Session publishing, reading, Profile, Discovery, and
            Resume services. By creating an account or sharing a Session, you agree to them. The
            short version: your content remains yours, you are responsible for what you disclose, do
            not use the service to harm people, and the service is provided as-is.
          </p>

          <h2>The service</h2>
          <p>
            Spool hosts agent Sessions that authors explicitly share, serves them at durable URLs,
            and may list Shared Sessions on Profiles, Explore, and search. Supported clients can
            materialize a Shared Session as new agent-native work. The service does not host or
            restore a complete project repository.
          </p>
          <p>
            The service is currently free and provided <strong>as is</strong>, without warranties of
            any kind. We may change or discontinue features. If the service itself is discontinued,
            we will provide reasonable notice and an opportunity to retrieve content when possible.
          </p>

          <h2>Your account</h2>
          <p>
            You are responsible for activity under your account and for protecting authenticated
            devices and credentials. You can manage or delete the account from{' '}
            <a href="/me">your account page</a>. Deletion is described in the{' '}
            <a href="/privacy">privacy policy</a>.
          </p>

          <h2>Your content</h2>
          <p>
            Your Session content remains yours. You grant us a non-exclusive license to store,
            verify, copy, display, and distribute a Shared Session as needed to operate its URL,
            reader, Profile listing, Discovery entry, previews, and Resume APIs. This license ends
            when the content is deleted, subject to security records, legal obligations, and copies
            made by third parties.
          </p>
          <p>
            You are responsible for everything you share or publish, including user messages, agent
            output, tool activity, code, credentials, personal information, and third-party
            material. You confirm that you have the right to disclose it.
          </p>

          <h2>Visibility</h2>
          <p>
            Anyone with a Shared Session URL can read it. Supported Sessions are Public by default
            after the author confirms Share and may appear in Explore, search, or previews.
            Providers not yet supported by Explore remain Link-only. Spool is not a confidentiality
            service. Readers can copy content, and third-party caches or previews may outlive
            withdrawal.
          </p>

          <h2>Withdrawal</h2>
          <p>
            Withdrawing a Shared Session blocks new access and removes it from Spool's public
            surfaces. Withdrawal does not revoke copies already made by readers, search engines, or
            preview services.
          </p>

          <h2>Use restrictions</h2>
          <p>You may not use spool.pro to share, publish, or distribute:</p>
          <ul>
            <li>illegal content or material you do not have the right to disclose</li>
            <li>other people’s personal or confidential information without permission</li>
            <li>malware, phishing, credential theft, or content designed to deceive or harm</li>
            <li>harassment, credible threats, or incitement</li>
            <li>spam or bulk content intended primarily to manipulate search or promotion</li>
            <li>
              automated abuse, unauthorized scraping, security probing, or attempts to bypass rate
              limits and access controls
            </li>
          </ul>
          <p>
            Use the report control on a Public Session or contact{' '}
            <a href="mailto:abuse@spool.pro">abuse@spool.pro</a>.
          </p>

          <h2>Removal and termination</h2>
          <p>
            We may remove content or suspend accounts that violate these terms or create material
            risk to users or the service. Where practical, we will explain the action. You may stop
            using the service and delete your account at any time.
          </p>

          <h2>Liability</h2>
          <p>
            To the maximum extent permitted by law, we are not liable for indirect, incidental, or
            consequential damages arising from use of the service. Our total liability for a claim
            is limited to the amount paid to use spool.pro during the previous twelve months—which
            is zero while the service is free.
          </p>

          <h2>Changes</h2>
          <p>
            We may update these terms as the service evolves. The date above shows the latest
            revision. We will announce material changes before they take effect when reasonably
            possible. Continued use after a change takes effect means you accept the revised terms.
          </p>

          <p className="sw-legal-credit">
            Structure adapted from the Basecamp open-source policies (CC BY 4.0).
          </p>
        </article>
      </main>
      <Footer />
    </Page>
  )
}
