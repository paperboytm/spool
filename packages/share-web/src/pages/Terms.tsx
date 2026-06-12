// Terms of service — static legal page, deliberately minimal: the
// service is free, so there are no billing/refund clauses, and we
// self-identify as the service rather than a named legal entity. The
// load-bearing parts are content ownership/responsibility and the use
// restrictions the report flow points at. Structure informed by the
// Basecamp open-source policies (CC BY 4.0).

import { useEffect } from 'react'

import { Footer, Header, Page } from '../components/Chrome'

const LAST_UPDATED = 'June 12, 2026'

export function Terms() {
  useEffect(() => {
    document.title = 'Terms · spool.pro'
  }, [])

  return (
    <Page>
      <Header auth="out" />
      <main className="sw-main">
        <article className="sw-card w-600 sw-legal">
          <p className="sw-eyebrow">spool.pro</p>
          <h1 className="sw-title">Terms of service</h1>
          <p className="sw-legal-date">Last updated: {LAST_UPDATED}</p>

          <p>
            These terms cover spool.pro, the publishing service for the
            Spool desktop app. By creating an account or publishing a
            share you agree to them. The short version: your content is
            yours, don't use the service to hurt people, and we provide
            it as-is.
          </p>

          <h2>The service</h2>
          <p>
            spool.pro hosts conversation snapshots you explicitly publish
            from the Spool app and serves them at public links, optionally
            listed on a public profile page. The service is currently
            free. We work hard to keep it fast and available, but it is
            provided <strong>as is</strong>, without warranties of any
            kind, and we may change or discontinue features — if we ever
            discontinue the service itself, we'll give you notice and
            time to take your content elsewhere.
          </p>

          <h2>Your account</h2>
          <p>
            You sign in with Google and are responsible for activity that
            happens under your account. You can delete your account at any
            time from <a href="/me">your account page</a>; deletion is
            described in the <a href="/privacy">privacy policy</a>.
          </p>

          <h2>Your content</h2>
          <p>
            What you publish stays yours. You grant us the non-exclusive
            license needed to operate the service — to store, copy,
            display, and distribute your published shares at their links,
            on your profile if listed, and in previews such as
            social-media cards. This license ends for a share when you
            unpublish it, except where the privacy policy describes
            residual copies.
          </p>
          <p>
            You are responsible for what you publish. Conversations can
            contain things you didn't write — other people's words, AI
            output, pasted code, credentials, personal data. Publishing
            makes all of it public, and by publishing you confirm you
            have the right to do that.
          </p>
          <p>
            <strong>Unpublishing is permanent.</strong> The link dies
            within seconds and can never be revived; republishing the
            same draft produces a new link. Copies made by third parties
            while a share was live (search engines, link previews) are
            outside our control.
          </p>

          <h2>Use restrictions</h2>
          <p>You may not use spool.pro to publish or do any of the following:</p>
          <ul>
            <li>content that is illegal or that you don't have the right to share</li>
            <li>other people's personal or private information (doxxing)</li>
            <li>malware, phishing, or content designed to deceive or harm</li>
            <li>harassment, threats, or incitement</li>
            <li>spam, or bulk publishing for SEO or promotional schemes</li>
            <li>
              anything that disrupts the service — probing or breaking
              security and rate limits, scraping accounts, automated
              abuse
            </li>
          </ul>
          <p>
            Every published share carries a report link. You can also
            reach us at{' '}
            <a href="mailto:abuse@spool.pro">abuse@spool.pro</a>.
          </p>

          <h2>Removal and termination</h2>
          <p>
            We may remove content or suspend accounts that violate these
            terms — where practical we'll tell you why. Nothing here
            limits your ability to walk away: your account and everything
            in it can be deleted by you, at any time, for any reason.
          </p>

          <h2>Liability</h2>
          <p>
            To the maximum extent permitted by law, we are not liable for
            indirect, incidental, or consequential damages arising from
            your use of the service, and our total liability for any
            claim is limited to the amount you've paid us to use
            spool.pro in the past twelve months — which, for a free
            service, is zero.
          </p>

          <h2>Changes</h2>
          <p>
            We may update these terms as the service evolves. The date at
            the top reflects the latest revision; material changes will
            be announced on the site before they take effect. Using the
            service after a change takes effect means you accept the
            revised terms.
          </p>

          <p className="sw-legal-credit">
            Structure adapted from the Basecamp open-source policies
            (CC BY 4.0).
          </p>
        </article>
      </main>
      <Footer />
    </Page>
  )
}
