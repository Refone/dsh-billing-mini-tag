/**
 * dsh-billing-mini-tag — browser half.
 *
 * The composer statistics strip is the `conversation.composer.dock` list slot:
 * `activity` (order 0) and `usage` (order 1, token total and cache hit) are
 * the shipped entries. A list slot adds an entry with a fresh id as another
 * control in the same row, so this package registers `billing-mini-tag` with
 * `order: 2`.
 *
 * InputBar appends the shipped context-usage meter *after* that slot, so slot
 * order alone would leave the amount between the usage pill and the meter.
 * The slot's outlet wrapper is `display: contents`, so this anchor is a direct
 * flex item of the dock; a positive `order` therefore moves the amount past
 * the default-order meter and keeps it at the far right of the row — the
 * original layout.
 *
 * The amount comes from the host half's same-origin route:
 *
 *   GET /plugin-billing-mini-tag/cost?session=<sessionId>
 *
 * The host prices the Session's durable token usage against the latest
 * official quote. This component only formats the returned amount, polling
 * once per second while it is mounted, so a completed step or a refreshed
 * quote is reflected without a page reload.
 *
 * Hand-written CommonJS wrapper around the shared, frozen module table: only
 * `react` is required, so no build step is needed.
 */
window.__ModuleLoader__.load({
	id: "dsh-billing-mini-tag",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const react = require("react");
		const h = react.createElement;

		/** Locale namespace owned by this plugin. */
		const NAMESPACE = "billing-mini-tag";
		/** Host route that returns the current Session's spend. */
		const COST_ENDPOINT = "/plugin-billing-mini-tag/cost";
		/** The host route is local and cheap; one second keeps the amount live. */
		const POLL_MS = 1000;
		/** Currency symbol of the official CNY quote. */
		const SYMBOL = "¥";

		/**
		 * The statistics strip renders every control as an inline-flex anchor
		 * plus a pill; these read the same typography tokens the shipped pills
		 * use, without copying their hashed class names.
		 *
		 * `order` places the amount after the shipped context-usage meter:
		 * that meter is not part of the dock slot but a sibling InputBar
		 * renders after it, so without this the amount would sit to the
		 * meter's left. The slot outlet is `display: contents`, which makes
		 * this anchor a direct flex item of the dock and lets the order apply.
		 */
		const anchorStyle = {
			order: 1,
			display: "inline-flex",
			minWidth: 0,
			fontSize: "calc(var(--dsh-content-font-size-secondary, 13px) - 1px)",
			lineHeight: "calc(20px + var(--dsh-content-font-delta-secondary, 0px))",
		};

		/** A static reading in the same rhythm as the shipped statistics pills. */
		const pillStyle = {
			boxSizing: "border-box",
			display: "inline-flex",
			alignItems: "center",
			gap: 6,
			maxWidth: "100%",
			padding: "1px 8px",
			border: "none",
			borderRadius: "var(--dsw-radius-sm, 6px)",
			background: "none",
			color: "var(--dsw-alias-label-tertiary, #8a8a8e)",
			font: "inherit",
			fontVariantNumeric: "tabular-nums",
			whiteSpace: "nowrap",
			userSelect: "none",
			cursor: "default",
		};

		/** Fallback translator: keys resolve to the key itself. */
		function passthrough(key) {
			return key;
		}

		/**
		 * Format a raw yuan amount for the pill.
		 *
		 * Two decimals match the `¥x.xx` contract; an amount that is positive
		 * but rounds to zero reads `<¥0.01` instead of a misleading `¥0.00`.
		 *
		 * @param {unknown} value - amount in yuan from the host route.
		 * @returns {string} display text, always starting with the symbol.
		 */
		function formatAmount(value) {
			const amount = Number(value);
			if (!Number.isFinite(amount) || amount <= 0) return `${SYMBOL}0.00`;
			if (amount < 0.005) return `<${SYMBOL}0.01`;
			return `${SYMBOL}${amount.toFixed(2)}`;
		}

		/**
		 * Localized name of the quote the host answered with.
		 *
		 * @param {(key: string) => string} t - bound translator.
		 * @param {unknown} source - `quote.source` from the host route.
		 * @returns {string} label, empty when the source is unknown.
		 */
		function sourceLabel(t, source) {
			if (source === "official") return t("cost.source.official");
			if (source === "builtin") return t("cost.source.builtin");
			return "";
		}

		/**
		 * Whether a fresh answer repeats the reading already on screen.
		 *
		 * @param {object|null} previous - current state.
		 * @param {object} next - freshly parsed route answer.
		 * @returns {boolean} true when nothing visible changed.
		 */
		function sameReading(previous, next) {
			if (previous === null || previous === undefined) return false;
			return previous.amount === next.amount
				&& previous.steps === next.steps
				&& previous.quote?.source === next.quote?.source
				&& previous.quote?.fetchedAt === next.quote?.fetchedAt;
		}

		/**
		 * Poll the host cost route for one Session.
		 *
		 * A new Session starts from zero; a token update inside the same
		 * Session keeps the previous amount until the fresh answer lands, so a
		 * completed step never flashes `¥0.00`. Failures keep the last good
		 * amount: a transient route hiccup should not reset the number.
		 *
		 * @param {string|undefined} sessionId - Session rendered by the dock.
		 * @returns {object|null} the last successful host response.
		 */
		function useSessionCost(sessionId) {
			const [cost, setCost] = react.useState(null);
			const activeSession = react.useRef(undefined);

			react.useEffect(() => {
				if (activeSession.current !== sessionId) {
					activeSession.current = sessionId;
					setCost(null);
				}
				if (typeof sessionId !== "string" || sessionId === "") return undefined;

				let alive = true;
				let timer = null;
				let controller = null;

				async function load() {
					controller = typeof AbortController === "function" ? new AbortController() : null;
					try {
						const response = await fetch(
							`${COST_ENDPOINT}?session=${encodeURIComponent(sessionId)}`,
							{
								credentials: "same-origin",
								cache: "no-store",
								signal: controller === null ? undefined : controller.signal,
							},
						);
						if (response.ok) {
							const data = await response.json();
							if (alive && data !== null && typeof data === "object" && data.ok === true && Number.isFinite(Number(data.amount))) {
								setCost((previous) => (sameReading(previous, data) ? previous : data));
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
			}, [sessionId]);

			return cost;
		}

		/** The visible pill, plus stable hooks for inspection and tests. */
		function BillingPill({ sessionId, t }) {
			const translate = typeof t === "function" ? t : passthrough;
			const cost = useSessionCost(sessionId);
			const amount = cost !== null && Number.isFinite(Number(cost.amount)) ? Number(cost.amount) : 0;
			const display = formatAmount(amount);

			const source = sourceLabel(translate, cost?.quote?.source);
			const unknown = cost !== null && Array.isArray(cost.unknownModels) && cost.unknownModels.length > 0
				? translate("cost.unknown")
				: "";
			const details = [source, unknown].filter((part) => part !== "").join(" · ");
			const title = details === ""
				? translate("cost.title", { amount: display, source: "" }).replace(/\s*·\s*$/, "")
				: translate("cost.title", { amount: display, source: details });

			return h(
				"span",
				{ style: anchorStyle, "data-composer-stat": "billing-mini-tag" },
				h(
					"span",
					{
						style: pillStyle,
						title,
						"aria-label": title,
						"data-billing-mini-tag": "",
						"data-billing-amount": amount.toFixed(4),
					},
					display,
				),
			);
		}

		/** Dictionaries for the pill's tooltip, one entry per shipped locale. */
		const DICTIONARIES = {
			zh: {
				"cost.title": "当前会话消费 {amount} · {source}",
				"cost.source.official": "官方报价",
				"cost.source.builtin": "内置报价",
				"cost.unknown": "未知模型按 Flash 价估算",
			},
			en: {
				"cost.title": "Current session spend {amount} · {source}",
				"cost.source.official": "official quote",
				"cost.source.builtin": "built-in quote",
				"cost.unknown": "unknown models priced as Flash",
			},
		};

		/** @param ctx - the browser-side cordis context for this plugin fiber. */
		function apply(ctx) {
			const locale = ctx.get("locale");
			let translate = passthrough;

			if (locale !== undefined && locale !== null) {
				for (const [id, dictionary] of Object.entries(DICTIONARIES)) {
					ctx.effect(
						() => locale.register(NAMESPACE, id, dictionary),
						`billing-mini-tag: ${id} dictionary`,
					);
				}
				translate = locale.bind(NAMESPACE);
			}

			ctx.slots.inject("conversation.composer.dock", () =>
				ctx.slots.register(
					{
						name: "conversation.composer.dock",
						id: "billing-mini-tag",
						order: 2,
					},
					(props) => h(BillingPill, { sessionId: props.sessionId, t: translate }),
				),
			);
		}

		exports.apply = apply;
		exports.inject = ["slots"];
		exports.BillingPill = BillingPill;
		exports.formatAmount = formatAmount;
		return module.exports;
	},
});
