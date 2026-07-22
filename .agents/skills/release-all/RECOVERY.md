# Resume an Interrupted Release

Recovery always advances the version already represented by the release commit or tag. It does not calculate or bump a new version.

## Establish the checkpoint

Inspect state before mutating it:

```bash
git status --porcelain
git log -3 --oneline --decorate
git tag --points-at HEAD
git ls-remote --heads origin main
git ls-remote --tags origin 'refs/tags/v*'
gh run list --workflow=release.yml --limit 10 \
  --json databaseId,headBranch,headSha,status,conclusion,url
gh release view "$TAG" --json tagName,url,assets 2>/dev/null || true
```

Read the version from the synchronized manifests and inspect the candidate commit with `git show --stat --oneline HEAD`. Accept it as a release checkpoint only when:

- its message is `release: v<VERSION>`
- its version changes are exactly those prescribed by `scripts/release.sh`
- all prescribed manifests agree on `VERSION`

If those facts disagree, stop and report the conflicting files or refs.

## Advance from the observed state

### Version edits exist, but no release commit

Proceed only when every worktree change is a prescribed version edit and all versions agree. Create the standard release commit and annotated tag:

```bash
git add -- <derived manifest paths>
git commit -m "release: $TAG"
git tag -a "$TAG" -m "$TAG"
```

### Release commit exists, but the tag does not

Create the annotated tag at the verified release commit:

```bash
git tag -a "$TAG" "$RELEASE_COMMIT" -m "$TAG"
```

### Commit and tag are local, but not remote

Fetch again. Require the release commit's parent to equal `origin/main` and the remote tag to remain absent, then push the existing checkpoint:

```bash
git push origin main
git push origin "$TAG"
```

A diverged `origin/main` requires stopping with both commit IDs so the user can reconcile them.

### Remote tag exists, but Release is absent or failed

Require the remote tag to resolve to the verified release commit. Dispatch the same tag and watch the new run:

```bash
gh workflow run release.yml --ref "$TAG"
```

Poll `gh run list` for a run whose `headBranch` is the tag and whose `headSha` is the release commit, then run:

```bash
gh run watch "$RUN_ID" --exit-status
```

The workflow is designed for same-version re-dispatch: existing npm versions are skipped, release notes are updated, and production web is dispatched again.

### npm and the GitHub release succeeded, but Deploy Web is absent or failed

Prefer re-dispatching the same-tag Release workflow so it owns and records the complete train. If npm and the GitHub release are already verified and only the deployment needs recovery, first require `origin/main` to equal the release commit, then dispatch production web explicitly and watch the resulting run:

```bash
gh workflow run deploy-web.yml --ref main -f target=production
```

If `origin/main` has advanced, stop and report the release commit and current remote commit instead of deploying an unverified revision.

## Return to verification

After the missing checkpoint succeeds, return to step 5 of `SKILL.md`. Recovery is complete only when every release target verifies at the same version.
