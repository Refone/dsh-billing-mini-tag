# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.1] - 2026-11-01

### Fixed

- The npm publish workflow could never reach `npm publish`: it ran `npm ci`,
  which fails with `EUSAGE` because the repository has no `package-lock.json`
  (the package has no runtime dependencies). The step is gone, and the job now
  runs `node scripts/check-release.mjs` before testing and publishing.

### Changed

- `.github/workflows/npm-publish.yml` publishes through npm Trusted Publishing
  (OIDC) with the existing `id-token: write` permission. No long-lived
  `NPM_TOKEN` secret is used. This release exists to validate that binding.

## [0.3.0] - 2026-11-01

### Changed

- `locale/en.json` and `locale/zh.json` no longer declare `meta.title`. DSH
  falls back to the package name (`dsh-billing-mini-tag`), which is also the
  component row's id and module name, so the detail page no longer repeats the
  technical name twice under the title.
- `scripts/check-release.mjs` accepts a missing `meta.title` and requires both
  locale files to declare the same keys.

### Fixed

- The browser half read the locale service with `ctx.get("locale")` while the
  fiber activated on `slots` alone. The locale provider mounts later, so the
  lookup answered `undefined`, the dictionaries were never registered, and the
  pill tooltip printed its raw key (`cost.title`) instead of a sentence.
  `locale` is now a declared dependency (`inject: ["slots", "locale"]`) and the
  dictionaries register through `ctx.locale`.

### Added

- `scripts/test-client.mjs` (`pnpm test`) renders the pill against a stubbed
  loader, React, slots service and locale runtime, and fails when the locale
  lookup regresses to the optional `ctx.get()`.

## [0.2.0] - 2026-11-01

### Changed

- The `¥x.xx` reading is now a real `conversation.composer.dock` control (id
  `billing-mini-tag`, `order: 2`) instead of a portal into the shipped
  statistics row. DSH 0.2 no longer renders a `[data-composer-stats]` wrapper,
  so the previous portal target no longer exists.
- The pill matches the shipped statistics pills through the same typography
  tokens and inline metrics, and stamps `data-composer-stat="billing-mini-tag"`.
- Token usage is read from the 0.2 stream record shape (`record.chunk.usage`)
  as well as the older bare `{ type: "usage" }` records, so folded step usage is
  no longer skipped.
- An amount that is positive but rounds to zero is displayed as `<¥0.01`
  instead of a misleading `¥0.00`.
- The plugin-inventory icon is now a white tile with the `¥` mark knocked out
  (an Arial Black glyph outline) instead of a blue tile with a white stroke.

### Fixed

- The `¥…` pill sits to the right of the context-usage meter again, at the far
  right of the statistics row. The dock slot renders before that meter, so the
  pill now carries a positive CSS `order` instead of stopping at the meter's
  left.

### Added

- `locale/en.json` and `locale/zh.json` with `meta.title` / `meta.description`
  for the plugin inventory, plus the pill tooltip copy; the tooltip reports the
  quote source (official / built-in) and unknown-model fallback.
- `icon.svg` for the plugin inventory.
- `engines.dsh` is now `>=0.2.0`.

## [0.1.0] - 2026-10-23

Initial release.

### Added

- Session spend tag (`¥x.xx`) rendered in the composer statistics row,
  immediately to the right of the cache-hit pill.
- Host route `GET /plugin-billing-mini-tag/cost?session=<sessionId>` that folds
  the durable session log per assistant step and returns the rounded amount
  plus the raw quote metadata.
- Official CNY quote parsed from the DeepSeek pricing page and refreshed at
  startup and on every message send, with a built-in quote when the page is
  unreachable.
- Per-step model tracking so a mid-session model switch is priced at the rate
  of the model that actually served each step.
- Beijing-time peak/off-peak windows (Mon–Fri 09:00–12:00 and 14:00–18:00).
- `dsh` bundle declaration (`dsh.bundle.patch` → `cordis.patch.yml`) so the
  package installs as a profile bundle.
