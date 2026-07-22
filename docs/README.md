# Documentation Map

Spool documentation has four distinct jobs. Keep each fact in the narrowest source of truth and link to it instead of copying product language across files.

## Product Truth

| Document                                                           | Owns                                                                |
| ------------------------------------------------------------------ | ------------------------------------------------------------------- |
| [`CONTEXT.md`](../CONTEXT.md)                                      | Canonical domain terms and meanings                                 |
| [`spool-positioning.md`](./spool-positioning.md)                   | Audience, problem, product loop, messaging, and public language     |
| [`product-architecture.zh-CN.md`](./product-architecture.zh-CN.md) | Product boundaries, objects, surfaces, trust model, and data flow   |
| [`DESIGN.md`](../DESIGN.md)                                        | Visual system, interaction rules, and surface-specific UX decisions |

When these documents disagree, resolve the disagreement here before changing UI copy or implementation.

## User Documentation

Public guides live in [`apps/web/src/content/docs`](../apps/web/src/content/docs):

- installation and quick start;
- publishing;
- reading and Resume;
- agent integration and Session sources;
- CLI and configuration reference.

User documentation describes shipped behavior. Product direction that is not yet available belongs in the positioning or architecture documents and must be labeled clearly if referenced publicly.

## Contributor Documentation

- [`README.md`](../README.md) — repository and product entry point
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — setup, verification, and development workflow
- [`team-operations.md`](./team-operations.md) — Team WorkOS/Cloudflare bootstrap, release order, and live checks
- package and app `README.md` files — module boundaries and local operation
- [`engineering-optimization-roadmap.md`](./engineering-optimization-roadmap.md) — dated engineering decision record

## Implementation Plans

The `plans/` directory is reserved for active implementation work. Completed plans are removed from the working tree and remain available in Git history. A plan may guide delivery, but it never defines current product language or public behavior.

## Maintenance Rules

1. Use `Session`, `Shared Session`, `Share`, `Publish`, `Link-only`, `Team-only`, `Team`, `Public`, `Profile`, `Discovery`, `Summary`, and `Resume` as defined in `CONTEXT.md`.
2. Never describe a Link-only URL as private or secret.
3. Describe Team-only as membership-gated, not as a secret URL. Use the visible label `Team · {name}` when naming its audience.
4. Describe the publishing boundary precisely: local preparation stays local, and selected content is sent only through an explicit Share action.
5. Keep shipped behavior and product direction visibly distinct.
6. Update public docs in the same change that alters a user-visible command, visibility rule, or Session page behavior.
7. Do not use implementation plan labels in product copy.
