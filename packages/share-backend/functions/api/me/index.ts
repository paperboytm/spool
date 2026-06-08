import type { D1Database, KVNamespace, PagesFunction } from '@cloudflare/workers-types'

import { requireUser } from '../../../src/auth/require'
import { jsonError, jsonOk } from '../../../src/errors'
import { resolveDisplayName } from '../../../src/profile/display-name'
import { CC_PRIVATE_NO_CACHE } from '../../../src/security/cache-control'

type Env = { DB: D1Database; SESSIONS: KVNamespace }

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  try {
    // /api/me is the bootstrap call for any signed-in client. A user with
    // a pending deletion still needs to see their own state — otherwise
    // they can't open the account UI to find the Cancel button. Other
    // mutating endpoints stay locked behind the default policy.
    const user = await requireUser(ctx.request, ctx.env, { allowPendingDeletion: true })
    const handle = await ctx.env.DB
      .prepare('SELECT handle FROM handles WHERE user_id=? AND released_at IS NULL')
      .bind(user.id)
      .first<{ handle: string }>()

    // Resolve the public-facing profile shape.
    //   display_name: user override > provider claim > email local-part
    //   avatar_url:   custom upload > provider claim (if avatar_visible)
    //                 > null (renderer falls back to initials)
    // Editing surfaces also need the raw fields to populate form
    // inputs (so the user can see "your current override" vs "off"),
    // so we expose both: `display_name` (resolved) for read-paths,
    // and `display_name_override` / `custom_avatar_id` / `avatar_visible`
    // for the Settings → Account form.
    // Append the avatar id as a cache-buster so a re-upload changes
    // the URL and the renderer's <img> + downstream HTTP caches refetch
    // instead of serving the previous bytes from memory. The backend
    // route is keyed on the path's user_id only, so the query string
    // is ignored server-side.
    const customAvatarUrl = user.custom_avatar_id
      ? `/api/avatars/${user.id}?v=${encodeURIComponent(user.custom_avatar_id)}`
      : null
    const visibleProviderAvatar = user.avatar_visible !== 0 ? user.avatar_url : null
    const avatar_url = customAvatarUrl ?? visibleProviderAvatar

    return jsonOk(
      {
        id: user.id,
        email: user.email,
        name: user.name,
        display_name: resolveDisplayName(user),
        // Explicit `?? null` so the JSON body always carries the
        // field, even when the row pre-dates the v0.6 migration
        // and the column reads as undefined off SQLite.
        display_name_override: user.display_name ?? null,
        avatar_url,
        custom_avatar_id: user.custom_avatar_id ?? null,
        avatar_visible: (user.avatar_visible ?? 1) !== 0,
        handle: handle?.handle ?? null,
        deletion_pending_until: user.deletion_pending_until,
      },
      { headers: { 'cache-control': CC_PRIVATE_NO_CACHE } },
    )
  } catch (e) {
    return jsonError(e)
  }
}
