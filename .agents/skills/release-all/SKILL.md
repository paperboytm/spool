---
name: release-all
description: Publish the complete Spool release train: synchronized versions, desktop artifacts, npm packages, and the production web deployment.
disable-model-invocation: true
argument-hint: "[patch|minor]"
---

# Release All

Treat a Spool release as a **release train**: one version must reach every target defined by the repository. `scripts/release.sh`, `.github/workflows/release.yml`, and `.github/workflows/deploy-web.yml` are the sources of truth.

Invoking this skill authorizes the version commit, tag, push, package publication, GitHub release, and production deployment. Proceed without another confirmation after the gates pass.

## 1. Map the train

From the repository root, read the three source-of-truth files above. Interpret `$ARGS` as follows:

- empty or `patch` → patch release
- `minor` → minor release
- any other value → stop and state the supported values

Derive the current version, next version, tag, manifests changed by the release script, npm publish targets, expected release assets, and required repository secrets. Do not maintain a second hard-coded target list in this skill.

This step is complete when every derived target has a concrete verification check for the next version.

## 2. Gate the departure

Run the preflight checks before changing files:

```bash
git fetch origin main --tags
git branch --show-current
git status --porcelain
git rev-parse HEAD
git rev-parse origin/main
command -v gh
command -v jq
gh auth status
gh secret list --json name --jq '.[].name'
```

Require all of these conditions:

- the branch is `main`
- the worktree is clean
- local `HEAD` equals `origin/main`
- `gh` is authenticated and `jq` is available
- every non-automatic secret referenced by the release workflow appears in `gh secret list`
- the predicted tag is absent locally and on `origin`

If the repository instead shows evidence of an interrupted release—such as a `release: v…` commit or matching local tag—read [RECOVERY.md](RECOVERY.md) and resume that version. For any other failed gate, stop with the exact condition and one remediation.

This step is complete only when every gate passes or a verified interrupted release has entered recovery.

## 3. Launch once

Record the predicted version and tag, then run exactly one command:

```bash
./scripts/release.sh --patch
# or
./scripts/release.sh --minor
```

Use a timeout long enough for GitHub Actions to build, sign, notarize, publish, and return. After it exits, record the release commit from `git rev-parse HEAD`.

If any command fails after launch begins, continue the same version through [RECOVERY.md](RECOVERY.md). `release.sh` runs once per release attempt because another invocation would bump a second version.

This step is complete when the exact-tag Release workflow concludes successfully.

## 4. Wait for production web

The release commit's push to `main` starts Deploy Web independently. Poll for the run whose `headSha` equals the recorded release commit, then watch it:

```bash
gh run list --workflow=deploy-web.yml --commit "$RELEASE_COMMIT" \
  --limit 1 --json databaseId,headSha,status,conclusion,url
gh run watch "$WEB_RUN_ID" --exit-status
```

Poll for up to 60 seconds before treating a missing run as a recovery case. This step is complete when that exact-commit deployment succeeds.

## 5. Verify every carriage

Verify against the target map from step 1:

1. Every manifest changed by `release.sh` contains the new version.
2. `origin/main` contains the release commit and the remote tag resolves to it.
3. The exact-tag Release workflow succeeded.
4. The GitHub release exists and contains every artifact class uploaded by the workflow.
5. Every npm publish target resolves at the new version with `npm view <name>@<version> version`. Retry registry reads for up to two minutes.
6. Deploy Web succeeded for the release commit.

The release is complete only when all six checks pass. Report a compact table with the version/tag, GitHub release URL, Release workflow URL, npm packages, and Deploy Web URL. If a check remains red, report which carriages are already published and the exact resume action; never describe a partial release as complete.
