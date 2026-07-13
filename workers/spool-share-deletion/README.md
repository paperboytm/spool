# spool-share-deletion

Cron companion Worker for the share backend. `POST /api/me/delete` only
queues; this Worker's 6-hourly sweep does the actual deletion (D1 scrub,
KV tombstones, R2 cleanup). Pages Functions can't register crons, hence
the standalone Worker. The sweep logic lives in
`packages/share-backend/functions/_scheduled/deletion-worker.ts`
(unit-tested in `packages/share-backend/tests/deletion-worker.test.ts`;
the deploy shape — re-export path, binding set, cron — is pinned by
`tests/deletion-worker-deploy.test.ts` in the same suite).

## Deploy

```bash
cp wrangler.toml wrangler.local.toml   # gitignored; must end in .toml
# fill the two TODO ids (D1 database_id, META KV id) from the dashboard
pnpm run deploy                        # = wrangler deploy --config wrangler.local.toml
```

Then confirm the cron under the Worker's Triggers tab in the dashboard.

## Local end-to-end verification

Runs the real handler in workerd against local D1/KV/R2 simulations —
use this to prove the deploy unit works before touching prod:

```bash
cp wrangler.toml wrangler.local.toml
sed -i '' 's/TODO-fill-from-dashboard/local-verify/' wrangler.local.toml
P=/tmp/deletion-verify

# schema + seed (a due deletion with one published share)
npx wrangler d1 execute DB --local --config wrangler.local.toml --persist-to $P \
  --file ../../packages/share-backend/migrations/0001_init.sql
npx wrangler d1 execute DB --local --config wrangler.local.toml --persist-to $P \
  --file ../../packages/share-backend/migrations/0002_profile_customize.sql
npx wrangler d1 execute DB --local --config wrangler.local.toml --persist-to $P --command "
  INSERT INTO users(id,email,name,avatar_url,created_at,last_signin_at) VALUES('u1','u1@example.com','U One','https://x/a.png',1,1);
  INSERT INTO user_identities(provider,provider_sub,user_id,email,linked_at) VALUES('google','g-u1','u1','u1@example.com',1);
  INSERT INTO published_shares(id,user_id,title,visibility,version,published_at) VALUES('AAAAAAAAAAAAAAAAAAAAA','u1','t','unlisted',1,1);
  INSERT INTO deletion_queue(user_id,scheduled_at,cancelled) VALUES('u1',1,0);"
echo '{"seed":true}' > /tmp/snap.json
npx wrangler r2 object put spool-snapshots/AAAAAAAAAAAAAAAAAAAAA.json \
  --file /tmp/snap.json --local --config wrangler.local.toml --persist-to $P
npx wrangler kv key put "meta/AAAAAAAAAAAAAAAAAAAAA" \
  '{"owner":"u1","visibility":"unlisted","revoked_at":null,"version":1}' \
  --binding META --local --config wrangler.local.toml --persist-to $P

# run + trigger
npx wrangler dev --test-scheduled --config wrangler.local.toml --persist-to $P --port 8799 &
sleep 10
curl -s "http://127.0.0.1:8799/__scheduled?cron=0+*/6+*+*+*"   # expect 200

# assert
npx wrangler d1 execute DB --local --config wrangler.local.toml --persist-to $P --command \
  "SELECT email,name,deleted_at FROM users; SELECT COUNT(*) FROM deletion_queue;"
# expect: email='[deleted]', name=NULL, deleted_at set; queue count 0.
# KV meta/<slug> becomes a {version:0, revoked_at} tombstone; the R2
# object is gone (r2 object get errors).
```

Kill the dev server and `rm -rf /tmp/deletion-verify wrangler.local.toml`
when done.
