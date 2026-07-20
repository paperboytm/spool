import type { PagesFunction } from '@cloudflare/workers-types'
import { isDiscoverySessionSid } from '@spool-lab/session-kit'

import { audit } from '../../../../../../src/audit'
import {
  buildDiscoveryProjection,
  prepareDiscoveryProjectionUpsert,
  readDiscoveryView,
} from '../../../../../../src/discovery/projection'
import { ApiError, jsonError, jsonOk } from '../../../../../../src/errors'
import { requireHubUser } from '../../../../../../src/hub/auth'
import { validateHead, type HubEnv } from '../../../../../../src/hub/head'
import { writeManifest } from '../../../../../../src/hub/packs'
import { getHubSession, prepareHubSessionUpsert } from '../../../../../../src/hub/store'
import { parseHeadBody, requireSid } from '../../../../../../src/hub/wire'
import { publicBaseUrl } from '../../../../../../src/public-url'

// Step 3 of the share handshake: commit the head. Re-runs the same
// validation as push (the two calls race against nothing — heads are
// single-writer), requires every object to be present, then atomically
// advances the ref. The manifest object is what the read path uses to
// resolve record positions → oids.

export const onRequestPost: PagesFunction<HubEnv> = async (ctx) => {
  try {
    const user = await requireHubUser(ctx.request, ctx.env)
    const sid = requireSid(ctx.params['sid'])
    const body = await parseHeadBody(ctx.request)

    const { missing } = await validateHead(ctx.env.DB, user.id, sid, body)
    if (missing.length > 0) {
      throw new ApiError('CONFLICT', 'objects missing — upload before committing', {
        missing: missing.slice(0, 50),
      })
    }

    // Validate the declared view before advancing the head. Explore currently
    // supports Claude Code and Codex CLI; those providers publish by default,
    // while portable providers remain readable by URL without failing Share.
    const view = await readDiscoveryView(ctx.env.DB, ctx.env.HUB, user.id, body.viewOid)
    const existing = await getHubSession(ctx.env.DB, sid)
    const now = Date.now()
    const sessionUpsert = prepareHubSessionUpsert(ctx.env.DB, {
      sid,
      ownerUserId: user.id,
      root: body.root,
      recordCount: body.count,
      sig: body.sig,
      cardJson: body.cardJson,
      summaryMd: body.summaryMd,
      lineageJson: body.lineageJson,
      viewOid: body.viewOid,
      spoolFileOid: body.spoolFileOid,
      now,
    })
    const discoverySupported = isDiscoverySessionSid(sid)
    const statements = [sessionUpsert]
    if (discoverySupported) {
      statements.push(
        prepareDiscoveryProjectionUpsert(
          ctx.env.DB,
          buildDiscoveryProjection({
            sid,
            summaryMd: body.summaryMd,
            lineageJson: body.lineageJson,
            recordCount: body.count,
            publishedAt: existing?.created_at ?? now,
            updatedAt: now,
            view,
          }),
        ),
      )
    }

    await writeManifest(ctx.env.HUB, body.root, body.manifest)
    await ctx.env.DB.batch(statements)

    await audit(ctx.env.DB, ctx.env.RATE, ctx.request, {
      user_id: user.id,
      action: 'hub-share',
      target_id: sid,
      details: { root: body.root, count: body.count, public: discoverySupported },
    })

    return jsonOk({ url: `${publicBaseUrl(ctx.env)}/session/${sid}` })
  } catch (e) {
    return jsonError(e)
  }
}
