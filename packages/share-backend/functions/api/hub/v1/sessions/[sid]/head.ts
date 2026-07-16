import type { PagesFunction } from '@cloudflare/workers-types'

import { audit } from '../../../../../../src/audit'
import { requireHubUser } from '../../../../../../src/hub/auth'
import { validateHead, type HubEnv } from '../../../../../../src/hub/head'
import { writeManifest } from '../../../../../../src/hub/packs'
import { upsertHubSession } from '../../../../../../src/hub/store'
import { parseHeadBody, requireSid } from '../../../../../../src/hub/wire'
import { ApiError, jsonError, jsonOk } from '../../../../../../src/errors'
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

    await writeManifest(ctx.env.HUB, body.root, body.manifest)
    await upsertHubSession(ctx.env.DB, {
      sid,
      ownerUserId: user.id,
      root: body.root,
      recordCount: body.count,
      sig: body.sig,
      cardJson: body.cardJson,
      noteMd: body.noteMd,
      lineageJson: body.lineageJson,
      viewOid: body.viewOid,
      now: Date.now(),
    })

    await audit(ctx.env.DB, ctx.env.RATE, ctx.request, {
      user_id: user.id,
      action: 'hub-share',
      target_id: sid,
      details: { root: body.root, count: body.count },
    })

    return jsonOk({ url: `${publicBaseUrl(ctx.env)}/session/${sid}` })
  } catch (e) {
    return jsonError(e)
  }
}
