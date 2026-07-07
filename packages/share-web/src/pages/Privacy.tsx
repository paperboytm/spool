// Privacy policy — static legal page. Every factual claim below is
// grounded in the codebase; if behavior changes (new processor, new
// data category, different retention), this page MUST change in the
// same PR. Structure informed by the Basecamp open-source policies
// (CC BY 4.0) and Obsidian's summary-first layout.

import { useEffect } from 'react'

import { Footer, Header, Page } from '../components/Chrome'

const LAST_UPDATED = 'July 7, 2026'

export function Privacy() {
  useEffect(() => {
    document.title = 'Privacy · spool.pro'
  }, [])

  return (
    <Page>
      <Header />
      <main className="sw-main">
        <article className="sw-card w-600 sw-legal">
          <p className="sw-eyebrow">spool.pro</p>
          <h1 className="sw-title">Privacy policy</h1>
          <p className="sw-legal-date">Last updated: {LAST_UPDATED}</p>

          <div className="sw-legal-summary">
            <p>The short version:</p>
            <ul>
              <li>
                The Spool desktop app is local-first. Your session library
                never leaves your machine — the only thing that ever
                reaches our servers is a snapshot you explicitly publish.
              </li>
              <li>
                spool.pro runs no analytics, no trackers, no ads, and no
                third-party cookies.
              </li>
              <li>
                Unpublishing a share or deleting your account actually
                deletes the data.
              </li>
            </ul>
          </div>

          <h2>Who we are</h2>
          <p>
            spool.pro is the publishing service for{' '}
            <a href="https://spool.pro">Spool</a>, an open-source desktop
            app for browsing and sharing AI coding sessions. For anything
            in this policy, contact us at{' '}
            <a href="mailto:hello@spool.pro">hello@spool.pro</a>.
          </p>

          <h2>What we collect</h2>
          <p>
            <strong>Account.</strong> You sign in with Google. We request
            the <code>openid</code>, <code>email</code>, and{' '}
            <code>profile</code> scopes and use them for exactly one
            thing: signing you in and identifying your account. From
            those we store your email address, your name, and the URL of
            your Google profile picture. We never see your Google
            password and we request no access to any other Google data.
          </p>
          <p>
            <strong>Account customization, if you use it.</strong> An
            optional display name and an optional uploaded avatar,
            which replace the Google-provided name and picture wherever
            the service shows your account.
          </p>
          <p>
            <strong>Content you publish.</strong> When you click Publish
            in the desktop app, the snapshot you composed — and nothing
            else from your library — is uploaded and stored so it can be
            served at its share link.
          </p>
          <p>
            <strong>Operational data.</strong> A session cookie keeps you
            signed in (30 days, sliding, capped at 90). Security-relevant
            actions (sign-in, publish, unpublish) are recorded in an
            audit log together with a salted hash of your IP address and
            browser user-agent — the salt rotates daily and the hash
            cannot be reversed back to your IP. Rate-limit counters exist
            briefly to keep abuse in check.
          </p>
          <p>
            <strong>What we don't collect:</strong> no analytics, no
            behavioral tracking, no advertising identifiers, no
            third-party cookies. The desktop app sends no telemetry, and
            your local session library is never uploaded.
          </p>

          <h2>How we use it</h2>
          <p>
            To operate the service you asked for (signing you in and
            hosting your shares — in GDPR terms, performance
            of a contract) and to keep the service safe (rate limiting and
            audit logging — our legitimate interest in preventing abuse).
            That's the whole list.
          </p>

          <h2>Who we share it with</h2>
          <p>
            Two infrastructure providers, and nobody else:{' '}
            <strong>Cloudflare</strong> hosts the service and stores all
            data (Pages, D1, KV, R2), and <strong>Google</strong> handles
            sign-in; unless you upload a custom avatar, your profile
            picture is served from Google's CDN. We do not sell or share
            your personal information, in the everyday sense or in the
            CCPA sense.
          </p>

          <h2>Published content is public</h2>
          <p>
            That's the point of publishing. A share is visible to
            anyone who has its URL. Third parties — search
            engines, social-media link previews — may make their own
            copies, and those copies can outlive an unpublish. Treat
            publishing as you would posting publicly anywhere.
          </p>

          <h2>Retention and deletion</h2>
          <p>
            <strong>Unpublishing a share is immediate and permanent.</strong>{' '}
            The link stops working within seconds and the stored snapshot
            is deleted; the same link can never be brought back.
          </p>
          <p>
            <strong>Deleting your account</strong> starts a 24-hour grace
            window (so a mistaken click can be undone), after which every
            share is unpublished and its content deleted, and your
            account record is stripped of personal
            information. Residual copies in our infrastructure provider's
            automatic backups expire within 30 days.
          </p>

          <h2>Your rights</h2>
          <p>
            Everything is self-service. You can see and change everything
            we store about you from <a href="/me">your account page</a>,
            and delete all of it with the delete-account flow — no email
            required, no questions asked. You already hold a complete
            copy of anything you've published: you composed it locally in
            the app, and every live share serves its full content at its
            link. For privacy questions or anything you can't do from the
            account page, write to{' '}
            <a href="mailto:hello@spool.pro">hello@spool.pro</a>.
          </p>

          <h2>Children</h2>
          <p>
            spool.pro is not directed at children under 13 and we don't
            knowingly collect their data.
          </p>

          <h2>Changes</h2>
          <p>
            When this policy changes we'll update it here and adjust the
            date at the top. If a change meaningfully affects what we
            collect or how we use it, we'll say so on the site before it
            takes effect.
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
