/**
 * dsh-billing-mini-tag — browser half.
 *
 * The official statistics pills (`用量 … · 缓存命中 …%`) are rendered by
 * ui-chat's StatsPills inside the composer dock (`[data-composer-stats]`). The
 * dock itself is a vertical list, so a plain second dock entry would land on
 * a new line below the cache-hit pill. To sit *to the right of* the cache hit
 * we portal a small `¥…` billing tag into that same statistics row.
 *
 * The amount comes from the host half's same-origin route:
 *
 *   GET /plugin-billing-mini-tag/cost?session=<sessionId>
 *
 * The host prices the Session's durable token usage against the latest
 * official quote (pulled once per Send). This component only formats the
 * returned number to two decimals and polls while it is mounted, so a quote
 * refresh or a completed assistant step is reflected without a page reload.
 *
 * The tag carries `order: 1`, so even while the official pills mount and
 * unmount (a fresh turn grows the time pill before the usage pill), the tag
 * stays the last flex item — immediately right of the cache-hit text.
 *
 * Hand-written CommonJS wrapper around the shared, frozen module table: only
 * `react` and `react-dom` are required, so no build step is needed.
 */
window.__ModuleLoader__.load({
	id: "dsh-billing-mini-tag",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const react = require("react");
		const reactDom = require("react-dom");
		const h = react.createElement;

		/** The statistics row rendered by ui-chat's StatsPills. */
		const STATS_SELECTOR = "[data-composer-stats]";
		/** Host route that returns the current Session's spend. */
		const COST_ENDPOINT = "/plugin-billing-mini-tag/cost";
		/** Two decimals, exactly as the tag contract asks (e.g. `¥0.20`). */
		const SYMBOL = "¥";
		/**
		 * StatsPills returns null until the session has a step or token usage, and
		 * remounts across session switches. Re-scanning on a slow timer keeps the
		 * tag attached without a document-wide MutationObserver.
		 */
		const RESCAN_MS = 400;
		/**
		 * The host route is local and cheap. One second keeps the number live
		 * while an assistant turn streams without hammering the server.
		 */
		const POLL_MS = 1000;

		/** Deliberately quiet: same tertiary tone, size, and rhythm as the pills. */
		const tagStyle = {
			order: 1,
			display: "inline-flex",
			alignItems: "center",
			flex: "none",
			padding: "1px 4px",
			color: "var(--dsw-alias-label-tertiary, #8a8a8e)",
			font: "inherit",
			fontSize: "inherit",
			fontWeight: 500,
			letterSpacing: 0,
			lineHeight: "inherit",
			fontVariantNumeric: "tabular-nums",
			whiteSpace: "nowrap",
			userSelect: "none",
			cursor: "default",
		};

		/** Format a raw yuan amount with exactly two decimals. */
		function formatAmount(value) {
			const number = Number.isFinite(Number(value)) ? Number(value) : 0;
			return `${SYMBOL}${number.toFixed(2)}`;
		}

		/** Human label for where the quote came from. */
		function quoteLabel(cost) {
			const source = cost?.quote?.source;
			if (source === "official") return "官方报价";
			if (source === "builtin") return "内置报价";
			return "报价";
		}

		/**
		 * Poll the host cost route for one Session.
		 *
		 * `usageTick` comes from the `tokenUsage` projection, so a completed
		 * step refetches immediately instead of waiting for the next poll.
		 * Failures keep the last good amount: a transient route hiccup should
		 * not make the tag flicker back to zero.
		 *
		 * @param {string|undefined} sessionId - Session selected in the dock.
		 * @param {string} usageTick - compact token totals, used as a dependency.
		 * @returns {object|null} the last successful host response.
		 */
		function useSessionCost(sessionId, usageTick) {
			const [cost, setCost] = react.useState(null);
			const activeSession = react.useRef(null);

			react.useEffect(() => {
				// A new Session starts from zero; a token update inside the same
				// Session keeps the previous amount until the fresh answer lands,
				// so a completed step never flashes `¥0.00`.
				if (activeSession.current !== sessionId) {
					activeSession.current = sessionId;
					setCost(null);
				}
				if (typeof sessionId !== "string" || sessionId === "") return undefined;

				let alive = true;
				let timer = null;
				let controller = null;

				async function load() {
					if (!alive) return;
					controller = typeof AbortController === "function" ? new AbortController() : null;
					try {
						const res = await fetch(
							`${COST_ENDPOINT}?session=${encodeURIComponent(sessionId)}`,
							{
								credentials: "same-origin",
								cache: "no-store",
								signal: controller === null ? undefined : controller.signal,
							},
						);
						if (res.ok) {
							const data = await res.json();
							if (alive && data !== null && typeof data === "object" && data.ok === true && Number.isFinite(Number(data.amount))) {
								setCost(data);
							}
						}
					} catch {
						// Aborted on unmount/session switch, or the route is briefly away.
					}
					schedule();
				}

				function schedule() {
					if (!alive) return;
					timer = setTimeout(load, POLL_MS);
				}

				load();

				return () => {
					alive = false;
					if (timer !== null) clearTimeout(timer);
					if (controller !== null) controller.abort();
				};
			}, [sessionId, usageTick]);

			return cost;
		}

		/** The visible tag, plus stable hooks for inspection and tests. */
		function MiniTag({ sessionId, useProjection }) {
			// The dock slot always supplies `useProjection`. The fallback keeps a
			// standalone render (tests, exotic hosts) from crashing the composer.
			const useProjectionHook = typeof useProjection === "function" ? useProjection : () => undefined;
			const usage = useProjectionHook("tokenUsage");

			const usageTick = usage === null || usage === undefined
				? ""
				: [
					usage.uncachedInputTokens,
					usage.outputTokens,
					usage.cacheReadTokens,
					usage.cacheWriteTokens,
				].join(":");

			const cost = useSessionCost(sessionId, usageTick);
			const amount = cost !== null && Number.isFinite(Number(cost.amount)) ? Number(cost.amount) : 0;
			const display = formatAmount(amount);

			const unknown = cost !== null && Array.isArray(cost.unknownModels) && cost.unknownModels.length > 0
				? " · 未知模型按 Flash 价估算"
				: "";
			const title = cost !== null
				? `当前会话消费 ${display} · ${quoteLabel(cost)}${unknown}`
				: `当前会话消费 ${display}`;

			return h(
				"span",
				{
					"data-billing-mini-tag": "",
					"data-billing-amount": amount.toFixed(2),
					title,
					"aria-label": title,
					style: tagStyle,
				},
				display,
			);
		}

		/** Track the live composer statistics row, mounting/unmounting with it. */
		function useComposerStatsHost() {
			const [host, setHost] = react.useState(null);
			react.useEffect(() => {
				let current = null;
				const sync = () => {
					const next = typeof document === "undefined" ? null : document.querySelector(STATS_SELECTOR);
					if (next === current) return;
					current = next;
					setHost(next);
				};
				sync();
				const timer = setInterval(sync, RESCAN_MS);
				return () => {
					clearInterval(timer);
				};
			}, []);
			return host;
		}

		/**
		 * Dock entry: renders nothing in place, and portals the tag into the
		 * statistics row once that row exists.
		 */
		function MiniTagDock({ sessionId, useProjection }) {
			const host = useComposerStatsHost();
			if (host === null) return null;
			return reactDom.createPortal(
				h(MiniTag, { sessionId, useProjection }),
				host,
			);
		}

		const inject = ["slots"];

		/** @param ctx - the browser-side cordis context for this plugin fiber. */
		function apply(ctx) {
			ctx.slots.inject("conversation.composer.dock", () =>
				ctx.slots.register(
					{
						name: "conversation.composer.dock",
						id: "billing-mini-tag",
						order: 30,
					},
					MiniTagDock,
				),
			);
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.MiniTagDock = MiniTagDock;
		exports.MiniTag = MiniTag;
		return module.exports;
	},
});
