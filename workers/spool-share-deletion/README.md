# spool-share-deletion

Cron companion Worker for the Spool backend. `POST /api/me/delete` queues
an account deletion; this Worker's six-hour sweep performs the D1 scrub,
KV tombstones, and publication, avatar, and Hub R2 cleanup. Pages Functions
cannot register cron triggers, so the scheduled handler deploys as a standalone Worker.

The sweep logic lives in
`apps/backend/functions/_scheduled/deletion-worker.ts`, is covered by
`apps/backend/tests/deletion-worker.test.ts`, and has its deploy shape
pinned by `apps/backend/tests/deletion-worker-deploy.test.ts`.

## Deploy

Production resource identifiers are committed in `wrangler.prod.toml` and
match `apps/backend/wrangler.prod.toml`. They are not credentials; Wrangler
still authenticates through `CLOUDFLARE_API_TOKEN`.

```bash
pnpm run deploy:dry
pnpm run deploy:prod
```

The production Cloudflare workflow runs this deployment after D1 migrations
and before the Pages backend. That order publishes the fail-closed deletion
checks before the new Team endpoints become reachable. Confirm the six-hour
cron under the Worker's Triggers tab after the first deployment.

The Worker deliberately does not receive `WORKOS_API_KEY`. Account deletion
enqueues WorkOS membership cleanup in shared D1, then calls the protected
Pages drain endpoint configured by `WORKOS_OPERATIONS_URL`. Generate one
high-entropy shared token and set the same value on both deploy units:

```bash
wrangler pages secret put WORKOS_OPERATIONS_TOKEN --project-name spool-share-backend
wrangler secret put WORKOS_OPERATIONS_TOKEN --config wrangler.prod.toml
```

Pages uses its existing WorkOS key to execute the idempotent cleanup. If the
call fails, the outbox remains due for the next cron or authenticated Team
request.

## Local end-to-end verification

Runs the real handler in workerd against local D1/KV/R2 simulations —
use this to prove the deploy unit works before touching prod:

```bash
cp wrangler.toml wrangler.local.toml
sed -i '' 's/TODO-fill-from-dashboard/local-verify/' wrangler.local.toml
SPOOL_DELETION_STATE=/tmp/deletion-verify

# schema + seed (a due deletion with one published share)
npx wrangler d1 migrations apply spool-share-db --local \
  --config wrangler.local.toml --persist-to "$SPOOL_DELETION_STATE"
npx wrangler d1 execute DB --local --config wrangler.local.toml \
  --persist-to "$SPOOL_DELETION_STATE" --command "
  INSERT INTO users(id,email,name,avatar_url,created_at,last_signin_at) VALUES('u1','u1@example.com','U One','https://x/a.png',1,1);
  INSERT INTO user_identities(provider,provider_sub,user_id,email,linked_at) VALUES('google','g-u1','u1','u1@example.com',1);
  INSERT INTO published_shares(id,user_id,title,visibility,version,published_at) VALUES('AAAAAAAAAAAAAAAAAAAAA','u1','t','unlisted',1,1);
  INSERT INTO deletion_queue(user_id,scheduled_at,cancelled) VALUES('u1',1,0);"
echo '{"seed":true}' > /tmp/snap.json
npx wrangler r2 object put spool-snapshots/AAAAAAAAAAAAAAAAAAAAA.json \
  --file /tmp/snap.json --local --config wrangler.local.toml \
  --persist-to "$SPOOL_DELETION_STATE"
npx wrangler kv key put "meta/AAAAAAAAAAAAAAAAAAAAA" \
  '{"owner":"u1","visibility":"unlisted","revoked_at":null,"version":1}' \
  --binding META --local --config wrangler.local.toml \
  --persist-to "$SPOOL_DELETION_STATE"

# run + trigger
npx wrangler dev --test-scheduled --config wrangler.local.toml \
  --persist-to "$SPOOL_DELETION_STATE" --port 8799 &
sleep 10
curl -s "http://127.0.0.1:8799/__scheduled?cron=0+*/6+*+*+*"   # expect 200

# assert
npx wrangler d1 execute DB --local --config wrangler.local.toml \
  --persist-to "$SPOOL_DELETION_STATE" --command \
  "SELECT email,name,deleted_at FROM users; SELECT COUNT(*) FROM deletion_queue;"
# expect: email='[deleted]', name=NULL, deleted_at set; queue count 0.
# KV meta/<slug> becomes a {version:0, revoked_at} tombstone; the R2
# object is gone (r2 object get errors).
```

Kill the dev server and remove `/tmp/deletion-verify` plus `wrangler.local.toml`
when done.
