// Privacy policy — static legal page. Every factual claim below must
// change in the same PR as the behavior, processor, or retention rule it
// describes. Structure informed by the Basecamp open-source policies
// (CC BY 4.0) and Obsidian's summary-first layout.

import { useEffect } from 'react'

import { Footer, Header, Page } from '../components/Chrome'

const LAST_UPDATED = 'July 22, 2026'

export function Privacy() {
  useEffect(() => {
    document.title = 'Privacy · spool.new'
  }, [])

  return (
    <Page>
      <Header />
      <main className="sw-main">
        <article className="sw-card sw-legal w-600">
          <p className="sw-eyebrow">spool.new</p>
          <h1 className="sw-title">Privacy policy</h1>
          <p className="sw-legal-date">Last updated: {LAST_UPDATED}</p>

          <div className="sw-legal-summary">
            <p>The short version:</p>
            <ul>
              <li>Local Session preparation does not publish anything.</li>
              <li>
                Only the Session, range, Summary, and publication document you explicitly share are
                sent to spool.new.
              </li>
              <li>
                Supported Sessions are Public in Explore and search by default after you confirm
                Share; providers not yet supported by Explore remain Link-only. You can later move a
                Session into a Team, where Team-only access is limited to current members.
              </li>
              <li>
                Team creation, invitations, membership, and roles use the minimum account and
                administrative data needed to operate the workspace.
              </li>
              <li>spool.new runs no ads, behavioral analytics, or third-party tracking cookies.</li>
            </ul>
          </div>

          <h2>Who we are</h2>
          <p>
            spool.new is the publishing service for <a href="https://spool.new">Spool</a>, an
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
            <strong>Team and invitation information.</strong> When you create or join a Team, we
            store its name and the identifiers needed to connect it to a WorkOS organization. We
            also store membership and role information, join and update times, and the permissions
            derived from a role. For invitations, we store the recipient email address, requested
            role, inviter, pending, accepted, revoked, or expired status and related times, and
            WorkOS organization, membership, and invitation identifiers needed to deliver and
            reconcile access.
          </p>
          <p>
            <strong>Shared Session content.</strong> A Share action uploads the selected canonical
            Session records and range, integrity metadata, optional Summary, workspace metadata,
            derived reading view, and optional curated <code>.spool</code> document. It does not
            upload unrelated local Sessions.
          </p>
          <p>
            <strong>Operational data.</strong> Session cookies keep Web users signed in, and
            revocable credentials authenticate installed clients. Security-relevant actions are
            recorded in an audit log, including Team administration and visibility changes, with a
            salted hash of IP address and the client user-agent. The salt rotates daily. Short-lived
            counters support rate limiting and abuse prevention. Explore ranking uses daily
            qualified-read totals after a reader has spent active time with a Session and reached
            meaningful depth or interacted with its evidence. The qualified-read signal does not
            persist a raw IP address or user-agent.
          </p>
          <p>
            <strong>What we do not collect.</strong> We do not use advertising identifiers,
            behavioral analytics, third-party tracking cookies, or client telemetry.
          </p>

          <h2>How we use data</h2>
          <p>
            We use account and Shared Session data to provide the service you requested: sign-in,
            durable links, Session reading, Profiles, Discovery, Resume, withdrawal, and account
            management. We use Team and invitation information to create workspaces, deliver and
            reconcile invitations, apply role-based permissions, enforce Team-only access, and
            maintain an administrative history of membership and disclosure changes. We use limited
            operational data to protect the service against abuse, investigate security incidents,
            and resolve disputes.
          </p>

          <h2>Processors</h2>
          <p>
            <strong>Cloudflare</strong> hosts the Web application and stores service data in Pages,
            Workers, D1, KV, and R2. <strong>WorkOS</strong> operates authentication and may connect
            to the identity provider you select. WorkOS also processes Team organizations,
            memberships, and invitations on our behalf. We do not sell personal information or share
            it for cross-context behavioral advertising.
          </p>

          <h2>Visibility and recipients</h2>
          <p>
            A Shared Session has one of three visibility levels. <strong>Public</strong> means
            anyone can read it and it may appear in Explore, search, Profiles, and social-media
            previews.
            <strong> Link-only</strong> means anyone with its URL can read it, but it is not listed
            on Spool's public discovery surfaces. <strong>Team-only</strong>, shown as{' '}
            <strong>Team · name</strong>, requires the reader to be a current member of that Team.
            Leaving or being removed from a Team ends that access on subsequent requests.
          </p>
          <p>
            Moving a Session into a Team transfers control of the hosted Team asset to that
            workspace. Team Owners and Admins can manage its disclosure, including changing a
            Team-only Session to Public or Link-only. Public and Link-only recipients, search
            engines, preview services, and Team members may create copies outside our control, so
            confirm the selected content and sensitive-data findings before changing visibility.
          </p>

          <h2>Withdrawal, retention, and deletion</h2>
          <p>
            <strong>Withdrawing a personally owned Shared Session</strong> immediately blocks new
            reads, removes the current hosted copy from account and public surfaces, and makes its
            URL return a gone response. Changing visibility cannot restore that copy, but the author
            can later explicitly Share the same Session again.{' '}
            <strong>Withdrawing a Team-owned Session</strong> is permanent: a Team Owner or Admin
            can withdraw it, after which its URL returns gone and no member can revive it by
            submitting a new Session head. Withdrawal cannot revoke copies that readers or third
            parties already downloaded.
          </p>
          <p>
            <strong>Leaving or being removed from a Team</strong> removes your membership and
            access, but does not delete Team-owned Sessions or other Team assets. We may retain
            invitation status, administrative audit records, and a minimal membership-removal block
            containing internal and WorkOS identifiers so directory synchronization cannot silently
            restore access. Accepted, revoked, and expired invitations may remain in the Team's
            administrative history to reconcile membership, investigate abuse, and resolve access or
            role disputes.
          </p>
          <p>
            <strong>Deleting your account</strong> requires you first to transfer ownership of or
            archive every Team you own, then starts a 24-hour grace window. After that window, we
            withdraw your personally owned Shared Sessions, remove them from public surfaces, delete
            their owner-scoped Hub content and publication media, remove public Profile data, remove
            active Team memberships, and strip personal information from the account record.
            Team-owned assets remain with the Team even when you originally shared them; any
            underlying Session objects needed by those assets are re-homed to Team storage. Minimal
            removal blocks, invitation history, security records, and audit records may remain for
            the purposes described above. You do not need to Withdraw personally owned Sessions
            before deleting your account. Copies that readers, search engines, Team members, or
            other third parties made before deletion remain outside our control, and residual
            infrastructure backups expire on the provider's backup cycle.
          </p>
          <p>
            Security and audit records may be retained for the minimum period needed to prevent
            abuse, resolve disputes, and satisfy legal obligations.
          </p>

          <h2>Your choices and rights</h2>
          <p>
            Use <a href="/me">your account page</a> to review account data, manage Shared Sessions,
            change public Profile fields, manage Teams available to you, withdraw content, and start
            account deletion. Team Owners and Admins manage Team membership, roles, invitations, and
            Team-owned Session visibility. For access, correction, portability, deletion, or privacy
            questions you cannot complete there, email{' '}
            <a href="mailto:hello@spool.pro">hello@spool.pro</a>. A request concerning your
            individual account does not delete assets owned by a Team; those assets remain under
            Team control.
          </p>

          <h2>Children</h2>
          <p>
            spool.new is not directed at children under 13, and we do not knowingly collect their
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
