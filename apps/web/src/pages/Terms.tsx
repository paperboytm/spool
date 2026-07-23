// Terms of service — static legal page. Keep every service and content
// claim aligned with the publishing, visibility, withdrawal, and account
// behavior implemented by spool.new.

import { useEffect } from 'react'

import { Footer, Header, Page } from '../components/Chrome'

const LAST_UPDATED = 'July 22, 2026'

export function Terms() {
  useEffect(() => {
    document.title = 'Terms · spool.new'
  }, [])

  return (
    <Page>
      <Header />
      <main className="sw-main">
        <article className="sw-card sw-legal sw-card--600">
          <p className="sw-eyebrow">spool.new</p>
          <h1 className="sw-title">Terms of service</h1>
          <p className="sw-legal-date">Last updated: {LAST_UPDATED}</p>

          <p>
            These terms cover spool.new and its Session publishing, reading, Team, Profile,
            Discovery, and Resume services. By creating an account, joining a Team, or sharing a
            Session, you agree to them. The short version: rights in your content remain yours, Team
            workspaces control the hosted assets transferred to them, you are responsible for what
            you disclose, do not use the service to harm people, and the service is provided as-is.
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
            <a href="/privacy">privacy policy</a>. If you own a Team, you must transfer ownership or
            archive that Team before deleting your account.
          </p>

          <h2>Teams, roles, and invitations</h2>
          <p>
            A Team is a shared workspace with Owner, Admin, and Member roles. Owners control Team
            ownership and closure. Owners and Admins can invite and manage members, assign permitted
            roles, and manage Team-owned Session visibility. Members can access Team-only Sessions
            while their membership is active. You may invite someone only when you are authorized to
            add them and may use their email address only for that purpose.
          </p>
          <p>
            You are responsible for choosing appropriate roles and for activity performed through
            permissions you grant. A role change, removal, or departure can end an individual's
            access, but it does not delete assets owned by the Team. Team administrative actions are
            subject to the permissions shown in the service.
          </p>

          <h2>Your content</h2>
          <p>
            Your underlying intellectual-property rights in Session content remain yours or with
            their existing rights holder. You grant us a non-exclusive license to store, verify,
            copy, display, and distribute a Shared Session as needed to operate its URL, reader,
            Team workspace, Profile listing, Discovery entry, previews, and Resume APIs. This
            license ends when the hosted content is deleted, subject to security records, legal
            obligations, Team retention described below, and copies made by third parties.
          </p>
          <p>
            You are responsible for everything you share or publish, including user messages, agent
            output, tool activity, code, credentials, personal information, and third-party
            material. You confirm that you have the right to disclose it.
          </p>
          <p>
            Moving a Session into a Team transfers ownership and control of the hosted Spool asset
            to that Team workspace. It does not by itself transfer underlying intellectual-property
            rights between you, your employer, or other Team participants; those rights follow your
            separate agreements and applicable law. Once transferred, the Team keeps the hosted
            asset if the original author later leaves, is removed, or deletes their account.
          </p>

          <h2>Visibility</h2>
          <ul>
            <li>
              <strong>Public</strong> Sessions can be read by anyone and may appear in Explore,
              search, Profiles, and previews.
            </li>
            <li>
              <strong>Link-only</strong> Sessions can be read by anyone with the URL, but are not
              listed on Spool's public discovery surfaces.
            </li>
            <li>
              <strong>Team-only</strong> Sessions, shown as <strong>Team · name</strong>, can be
              read only by current members of that Team.
            </li>
          </ul>
          <p>
            Supported Sessions are Public by default after the author confirms Share; providers not
            yet supported by Explore remain Link-only. Moving a Session to Team-only removes it from
            public discovery. Team Owners and Admins may later change a Team-owned Session to Public
            or Link-only, which discloses it outside the Team. By transferring an asset to a Team,
            you authorize those roles to make visibility decisions for its hosted copy.
          </p>
          <p>
            Spool applies access controls to Team-only Sessions, but no online service can guarantee
            absolute confidentiality. Authorized Team members can copy content. Public and Link-only
            readers, third-party caches, and previews may retain copies after visibility changes or
            withdrawal.
          </p>

          <h2>Withdrawal</h2>
          <p>
            Withdrawing a personally owned Shared Session immediately blocks new access, removes its
            current hosted copy from public and management surfaces, and makes its URL return a gone
            response. Visibility changes cannot restore that copy, but the author may later
            explicitly Share the same Session again. Withdrawing a Team-owned Session is permanent:
            a Team Owner or Admin can withdraw it, and no Team member can revive it through a new
            Session head. Withdrawal does not revoke copies already made by readers, Team members,
            search engines, or preview services. Leaving a Team or deleting an individual account
            does not withdraw or delete Team-owned assets; they remain under Team control.
          </p>

          <h2>Use restrictions</h2>
          <p>You may not use spool.new to share, publish, or distribute:</p>
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
            is limited to the amount paid to use spool.new during the previous twelve months—which
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
