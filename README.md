# dsh-lrf-hint

A small DeepSeek Harness (DSH) Web plugin. It renders the literal text **LRF**
just to the right of the composer's cache-hit figure — the
`用量 … · 缓存命中 …%` statistics row that sits under the input box.

## How it works

- The node half (`lib/index.js`) is a no-op Loader row. Its only job is to make
  the package discoverable by `dsh-client-modules`, which serves the browser
  bundle from `/plugins`.
- The browser half (`lib/client.js`) registers an entry in
  `conversation.composer.dock`, then portals a `<span data-lrf-hint>LRF</span>`
  into `[data-composer-stats]` — the statistics row that ui-chat's `StatsPills`
  renders below the composer.
- The label uses CSS `order: 1`, so it always stays the last item in that flex
  row, immediately right of the cache-hit pill, even as the official pills come
  and go (a fresh session has no statistics row at all, and the label simply
  does not render until it appears).

No build step is required: `lib/client.js` is a hand-written bundle wrapper that
only requires the shell's frozen `react` / `react-dom` modules.

## Install into the running Web GUI

From this directory:

```sh
dsh plugin --profile web add /Users/refone/Coding/dsh-billing-hint
```

`dsh plugin` forwards to pnpm inside the profile, then appends the package to
`dsh.profile.bundles` because the package declares `dsh.bundle.patch`. With
`dsh-hot-installer` active the new layer is applied without restarting the
server; refresh the page to load the client bundle.

To remove it:

```sh
dsh plugin --profile web remove dsh-lrf-hint
```

## Layout contract

| Piece | Detail |
|---|---|
| Slot | `conversation.composer.dock` |
| Portal target | `[data-composer-stats]` (ui-chat `StatsPills`) |
| Anchor | the cache-hit pill is the last official child; `order: 1` keeps LRF after it |
| Label | `<span data-lrf-hint>LRF</span>`, tertiary label color, inherited font |

If ui-chat ever drops `data-composer-stats`, the plugin degrades to rendering
nothing rather than disturbing the composer layout.
