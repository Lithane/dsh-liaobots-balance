# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-10-21

### Changed

- Removed the remaining-ratio row and the progress bar from the popover. The ratio of
  remaining credits to total quota added no information the two amounts do not already
  show, so the popover now stops at total quota and credits spent. The host routes still
  return `remainingRatio` for API consumers, and the client simply ignores it.
- Colour now follows the remaining balance only, never a ratio: the amount turns yellow
  below `lowThreshold` (default **5**) and red below `criticalThreshold` (default **1**).
  The previous defaults were 10 and 3.

## [1.0.0] - 2026-10-10

First public release.

### Added

- Sidebar footer card showing the remaining Liaobots credits, opening a popover with total
  quota, spent credits, a remaining-ratio bar, low/critical threshold colouring and the most
  recent deductions. The card reuses the look and the collapse/refresh behaviour of
  [`dsh-balance-widget`](https://github.com/LL-cmyk-so/dsh-balance-widget).
- Host half: loopback-only `GET /api/dsh-liaobots/balance` and `GET /api/dsh-liaobots/usage`
  routes. The Liaobots login code is resolved in the host process through the DSH credentials
  service and never reaches the browser; non-loopback requests are answered with 403.
- Domain failover over `ai.liaobots.work` and the `ai.liaobots1/2/3.work` mirrors, remembering
  the last host that answered.
- 15–30 s host-side response cache shared by the card's 60 s poll and the popover's first paint.
- `liaobots_balance` agent tool (`query = balance | usage | both`), registered only when the
  `tools` service is present, with the `output { schema, render }` shape the host registry requires.
- `stackCards` layout option: the card claims a full footer row and wraps the footer flex row
  through the `__dshBalanceCardWrap` reference counter shared with `dsh-account-balance`, so
  either plugin can be unloaded in any order.
- Duplicate-mount claims for routes and the agent tool keyed on `globalThis[Symbol.for(...)]`,
  so a plugin-tree recomposition adopts the live registration instead of colliding with it.
- Locale display metadata (`locale/en.json`, `locale/zh.json`), so the plugin list shows
  **Liaobots Balance** / **Liaobots 余额** instead of the module name.
- Test suite: 26 host tests, 18 jsdom browser tests and 7 packaging tests (51 total).
- CI on GitHub Actions: Node 22 and 24 on Ubuntu and Windows, plus a publishable-contents check.

### Notes

- Requires `@deepseek-ai/dsh` `>=0.1.2-rc.1 <0.3.0`. A bundle whose peer range does not match
  the running DSH is skipped silently (it only shows up in `skippedBundles`), so run
  `node test/package.test.mjs <new-version>` before upgrading DSH.
- No runtime dependencies; the browser half is plain JavaScript loaded by the GUI without a
  build step.

[Unreleased]: https://github.com/Lithane/dsh-liaobots-balance/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/Lithane/dsh-liaobots-balance/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Lithane/dsh-liaobots-balance/releases/tag/v1.0.0
