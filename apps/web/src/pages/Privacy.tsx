// Privacy policy — static legal page. Every factual claim below must
// change in the same PR as the behavior, processor, or retention rule it
// describes. Structure informed by the Basecamp open-source policies
// (CC BY 4.0) and Obsidian's summary-first layout.

import { useEffect } from 'react'

import { Footer, Header, Page } from '../components/Chrome'

const LAST_UPDATED = 'July 18, 2026'

export function Privacy() {
  useEffect(() => {
    document.title = 'Privacy · spool.pro'
  }, [])

  return (
    <Page>
      <Header />
      <main className="sw-main">
        <article className="sw-card sw-legal w-600">
          <p className="sw-eyebrow">spool.pro</p>
          <h1 className="sw-title">Privacy policy</h1>
          <p className="sw-legal-date">Last updated: {LAST_UPDATED}</p>

          <div className="sw-legal-summary">
            <p>The short version:</p>
            <ul>
              <li>Local Session preparation does not publish anything.</li>
              <li>
                Only the Session, range, Summary, and publication document you explicitly share are
                sent to spool.pro.
              </li>
              <li>
                Shared Sessions are public and may appear in Explore and search after you confirm
                sharing.
              </li>
              <li>spool.pro runs no ads, behavioral analytics, or third-party tracking cookies.</li>
            </ul>
          </div>

          <h2>Who we are</h2>
          <p>
            spool.pro is the publishing service for <a href="https://spool.pro">Spool</a>, an
            open-source platform for sharing and continuing agent Sessions. Contact us at{' '}
            <a href="mailto:hello@spool.pro">hello@spool.pro</a>.
          </p>

          <h2>What we collect</h2>
          <p>
            <strong>Account information.</strong> WorkOS AuthKit operates sign-in. Depending on the
            method you choose, we receive an identity identifier, email address, name, and profile
            picture URL. We use them to authenticate you and display your account. We never receive
            your identity-provider password.
          </p>
          <p>
            <strong>Profile information.</strong> If you create a public Profile, we store the
            handle, display name, avatar, bio, and other fields you choose to show.
          </p>
          <p>
            <strong>Shared Session content.</strong> A Share action uploads the selected canonical
            Session records and range, integrity metadata, optional Summary, workspace metadata,
            derived reading view, and optional curated <code>.spool</code> document. It does not
            upload unrelated local Sessions.
          </p>
          <p>
            <strong>Operational data.</strong> Session cookies keep Web users signed in, and
            revocable credentials authenticate Desktop and CLI clients. Security-relevant actions
            are recorded in an audit log with a salted hash of IP address and the client user-agent.
            The salt rotates daily. Short-lived counters support rate limiting and abuse prevention.
            Explore ranking uses daily qualified-read totals after a reader has spent active time
            with a Session and reached meaningful depth or interacted with its evidence. The
            qualified-read signal does not persist a raw IP address or user-agent.
          </p>
          <p>
            <strong>What we do not collect.</strong> We do not use advertising identifiers,
            behavioral analytics, third-party tracking cookies, or Desktop telemetry.
          </p>

          <h2>How we use data</h2>
          <p>
            We use account and Shared Session data to provide the service you requested: sign-in,
            durable links, Session reading, Profiles, Discovery, Resume, withdrawal, and account
            management. We use limited operational data to protect the service against abuse and
            investigate security incidents.
          </p>

          <h2>Processors</h2>
          <p>
            <strong>Cloudflare</strong> hosts the Web application and stores service data in Pages,
            Workers, D1, KV, and R2. <strong>WorkOS</strong> operates authentication and may connect
            to the identity provider you select. We do not sell personal information or share it for
            cross-context behavioral advertising.
          </p>

          <h2>Visibility and recipients</h2>
          <p>
            A Shared Session is public and can appear on your Profile, in Explore and search, and in
            social-media previews. Anyone with its URL can read it. Search engines, preview
            services, and readers may create copies outside our control, so confirm the selected
            content and sensitive-data findings before sharing.
          </p>

          <h2>Withdrawal, retention, and deletion</h2>
          <p>
            <strong>Withdrawing a Shared Session</strong> blocks new reads and removes it from
            public surfaces. It cannot revoke copies that readers or third parties already
            downloaded.
          </p>
          <p>
            <strong>Deleting your account</strong> starts a 24-hour grace window. After that window,
            we withdraw your Shared Sessions, remove them from public surfaces, delete their
            owner-scoped Hub content and publication media, remove public Profile data, and strip
            personal information from the account record. You do not need to Withdraw Sessions
            before deleting your account. Copies that readers, search engines, or other third
            parties made before deletion remain outside our control, and residual infrastructure
            backups expire on the provider's backup cycle.
          </p>
          <p>
            Security and audit records may be retained for the minimum period needed to prevent
            abuse, resolve disputes, and satisfy legal obligations.
          </p>

          <h2>Your choices and rights</h2>
          <p>
            Use <a href="/me">your account page</a> to review account data, manage Shared Sessions,
            change public Profile fields, withdraw content, and start account deletion. For access,
            correction, portability, deletion, or privacy questions you cannot complete there, email{' '}
            <a href="mailto:hello@spool.pro">hello@spool.pro</a>.
          </p>

          <h2>Children</h2>
          <p>
            spool.pro is not directed at children under 13, and we do not knowingly collect their
            data.
          </p>

          <h2>Changes</h2>
          <p>
            When this policy changes, we update the date above. We will announce a material change
            before it takes effect when reasonably possible.
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
