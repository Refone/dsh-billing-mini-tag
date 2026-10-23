# dsh-billing-mini-tag

A small DeepSeek Harness (DSH) Web plugin. It renders the current Session's
spend as a compact **`¥0.00`** tag just to the right of the composer's
cache-hit figure — the `用量 … · 缓存命中 …%` statistics row that sits under
the input box.

The amount is the Session's actual token spend, calculated from:

- the **latest official DeepSeek token quote** (fetched from the official
  pricing page once at startup and once on every message Send),
- the **model that served each assistant step** (so a mid-session model switch
  is priced correctly),
- the **provider-reported token usage** of the Session (`cache-miss input`,
  `cache-hit input`, `output`, plus cache-write when a provider reports it).

## How it works

- The browser half (`src/client.js`) registers an entry in
  `conversation.composer.dock`, then portals a
  `<span data-billing-mini-tag>¥0.00</span>` into `[data-composer-stats]` — the
  statistics row that ui-chat's `StatsPills` renders below the composer.
- It polls `GET /plugin-billing-mini-tag/cost?session=<sessionId>` once a
  second and whenever the `tokenUsage` projection advances, then displays the
  amount with exactly two decimals (`toFixed(2)`), e.g. `¥2.34`, `¥0.20`.
- The host half (`src/index.js`) keeps the DSH Loader row, owns the official
  quote, folds each live Session's durable log into per-step usage, and serves
  that one JSON route. A fresh quote is pulled when a `user/message` event
  arrives — the durable trace of pressing Send.
- The tag uses CSS `order: 1`, so it always stays the last item in that flex
  row, immediately right of the cache-hit pill, even as the official pills come
  and go (a fresh session has no statistics row at all, and the tag simply does
  not render until it appears).

No build step is required: `src/client.js` is a hand-written bundle wrapper that
only requires the shell's frozen `react` / `react-dom` modules.

## Pricing rules

The official page lists prices per 1M tokens in CNY, with peak and off-peak
rates. Peak windows are Beijing time Monday–Friday 09:00–12:00 and 14:00–18:00
(Chinese public holidays are not in the quote, so weekday windows are the local
approximation). Each step is priced by the window containing its completion
time:

```
step cost = (uncachedInput × cacheMissPrice
           + cacheRead     × cacheHitPrice
           + cacheWrite    × cacheMissPrice
           + output        × outputPrice) / 1,000,000
```

`output` includes reasoning tokens, because providers report reasoning inside
the completion count. If a future model is not on the pricing page, the tag
falls back to the Flash bucket instead of hiding the cost.

If the official page cannot be reached, the plugin keeps the last successful
quote; before the first success it uses a built-in copy of the official CNY
prices so the tag still shows a meaningful amount. The tag's hover text says
which quote source was used.

## Install into the running Web GUI

From this directory:

```sh
dsh plugin --profile web add /Users/refone/Coding/dsh-billing-mini-tag
```

`dsh plugin` forwards to pnpm inside the profile, then appends the package to
`dsh.profile.bundles` because the package declares `dsh.bundle.patch`. With
`dsh-hot-installer` active the new layer is applied without restarting the
server; refresh the page to load the client bundle.

To remove it:

```sh
dsh plugin --profile web remove dsh-billing-mini-tag
```

## Layout contract

| Piece | Detail |
|---|---|
| Slot | `conversation.composer.dock` |
| Portal target | `[data-composer-stats]` (ui-chat `StatsPills`) |
| Anchor | the cache-hit pill is the last official child; `order: 1` keeps the tag after it |
| Tag | `<span data-billing-mini-tag>¥0.00</span>`, tertiary label color, inherited font |
| Host route | `GET /plugin-billing-mini-tag/cost?session=<sessionId>` |
| Quote route | `GET /plugin-billing-mini-tag/quote` (inspection only) |

If ui-chat ever drops `data-composer-stats`, the plugin degrades to rendering
nothing rather than disturbing the composer layout. If the host route is
unavailable, the tag stays at `¥0.00` instead of crashing the composer.
