# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-10-23

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

## [0.1.0] - 2026-10-23

### Added

- Initial placeholder `LRF` tag next to the composer cache-hit statistics.
