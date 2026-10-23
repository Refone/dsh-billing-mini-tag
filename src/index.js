/**
 * dsh-billing-mini-tag — host half.
 *
 * The browser half renders the small `¥…` billing tag beside the composer's
 * cache-hit statistics. This half owns the two facts that tag needs:
 *
 *  1. The official DeepSeek token quote. It is pulled from the official
 *     Chinese pricing page once at startup and again on every message send
 *     (one `user/message` event), which is exactly "拉取一次官方报价".
 *  2. The current Session's token usage, folded from the durable Session log
 *     per assistant step. Each step remembers the model that actually served
 *     it, so a model switch mid-session is priced at the right rate.
 *
 * Both live behind one same-origin JSON route consumed by the browser half:
 *
 *   GET /plugin-billing-mini-tag/cost?session=<sessionId>
 *
 * The route returns a fully rounded display string (`¥0.00`) plus the raw
 * amount and quote metadata for debugging. It never throws to the browser:
 * an unknown Session, an unloaded log, or a failed price fetch all degrade to
 * a valid zero/previous-quote answer instead of disturbing the composer.
 *
 * This package deliberately has no build step and no third-party imports; it
 * only uses Node's standard `fetch` and the DSH services injected below.
 */

export const name = "dsh-billing-mini-tag";

/** Cordis services this host half depends on. */
export const inject = ["webServer", "sessions"];

/** Same-origin route namespace owned by this plugin. */
const API = "/plugin-billing-mini-tag";

/** Official DeepSeek pricing page (Chinese page carries CNY prices directly). */
const PRICING_URL = "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/";

/** Currency shown by the tag; the official CNY page prices in `元`. */
const SYMBOL = "¥";

/** Give up on a slow pricing page rather than pinning the request forever. */
const FETCH_TIMEOUT_MS = 8000;

/** Retry a failed startup quote at most this often when a cost poll arrives. */
const QUOTE_RETRY_MS = 30000;

/** Cap one backfill so a huge historical log cannot stall a route call. */
const MAX_EVENTS_PER_SYNC = 50000;

/** Bound the per-session fold cache; old sessions are cheap to rebuild. */
const MAX_CACHED_SESSIONS = 64;

/** China has no DST; peak windows are defined in Beijing time. */
const CHINA_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * Last-resort CNY prices copied from the official page at implementation time.
 * Used before the first successful fetch and whenever the page is unreachable,
 * so the tag can still show a meaningful (if not freshly quoted) amount.
 * Shape: price per 1M tokens, peak and off-peak, in CNY.
 */
const BUILTIN_MODELS = Object.freeze({
  "deepseek-flash": Object.freeze({
    cacheHit: Object.freeze({ offPeak: 0.02, peak: 0.04 }),
    cacheMiss: Object.freeze({ offPeak: 1, peak: 2 }),
    output: Object.freeze({ offPeak: 4, peak: 8 }),
  }),
  "deepseek-v4-pro": Object.freeze({
    cacheHit: Object.freeze({ offPeak: 0.15, peak: 0.3 }),
    cacheMiss: Object.freeze({ offPeak: 4.5, peak: 9 }),
    output: Object.freeze({ offPeak: 13.5, peak: 27 }),
  }),
});

/* ------------------------------------------------------------------ */
/* Official quote                                                      */
/* ------------------------------------------------------------------ */

/** Decode the handful of HTML entities the pricing table can contain. */
function decodeEntities(text) {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)));
}

/** Unique lowercase DeepSeek model ids in first-seen order. */
function modelIdsIn(text) {
  const ids = [];
  for (const match of text.matchAll(/deepseek-[a-z0-9.-]+/g)) {
    if (!ids.includes(match[0])) ids.push(match[0]);
  }
  return ids;
}

/**
 * Parse the official Chinese pricing table.
 *
 * The table is row-major: one price row per billing bucket and peak window,
 * with one cell per model (cache-hit, cache-hit-peak, cache-miss, …). Model
 * ids live in the header cell group before the first `BASE URL` row, which
 * keeps version strings such as `DeepSeek-V4.1-Flash-1017` out of the list.
 *
 * @param {string} html - page body fetched from {@link PRICING_URL}.
 * @returns {{source: string, fetchedAt: number, url: string, models: object}|null}
 *   parsed quote, or null when the page does not look like the known table.
 */
function parseOfficialQuote(html) {
  if (typeof html !== "string" || !html.includes("deepseek-flash")) return null;

  const tableMatch = /<table[^>]*>[\s\S]*?deepseek-flash[\s\S]*?<\/table>/i.exec(html);
  if (tableMatch === null) return null;

  const text = decodeEntities(tableMatch[0].replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

  const headerEnd = text.search(/BASE URL/i);
  const headerText = headerEnd > 0 ? text.slice(0, headerEnd) : text;
  let models = modelIdsIn(headerText);
  if (models.length === 0) models = modelIdsIn(text);
  if (models.length === 0) return null;

  // Price rows only: everything from 价格 to the following 并发限制 member.
  const priceStart = text.search(/价格/);
  const priceEnd = text.search(/并发限制/);
  const priceText = priceStart >= 0
    ? text.slice(priceStart, priceEnd > priceStart ? priceEnd : text.length)
    : text;

  const prices = [];
  for (const match of priceText.matchAll(/([0-9][0-9,]*(?:\.[0-9]+)?)\s*元/g)) {
    prices.push(Number(match[1].replace(/,/g, "")));
  }
  // Six prices per model, row-major. An unexpected count means the table grew
  // a row we do not understand; fall back instead of silently mispricing.
  if (prices.length !== models.length * 6) return null;

  const parsed = {};
  const count = models.length;
  for (let index = 0; index < count; index += 1) {
    const at = (row) => prices[row * count + index];
    const entry = {
      cacheHit: { offPeak: at(0), peak: at(1) },
      cacheMiss: { offPeak: at(2), peak: at(3) },
      output: { offPeak: at(4), peak: at(5) },
    };
    const values = [
      entry.cacheHit.offPeak,
      entry.cacheHit.peak,
      entry.cacheMiss.offPeak,
      entry.cacheMiss.peak,
      entry.output.offPeak,
      entry.output.peak,
    ];
    if (values.some((value) => !Number.isFinite(value) || value < 0)) return null;
    if (entry.cacheHit.peak < entry.cacheHit.offPeak) return null;
    if (entry.cacheMiss.peak < entry.cacheMiss.offPeak) return null;
    if (entry.output.peak < entry.output.offPeak) return null;
    parsed[models[index]] = entry;
  }

  return { source: "official", fetchedAt: Date.now(), url: PRICING_URL, models: parsed };
}

/** A built-in quote used until the first fetch succeeds (and when offline). */
function builtinQuote() {
  return {
    source: "builtin",
    fetchedAt: 0,
    url: PRICING_URL,
    models: BUILTIN_MODELS,
  };
}

/** Download and parse the official quote. */
async function fetchOfficialQuote() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(PRICING_URL, {
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml",
        "accept-language": "zh-CN,zh;q=0.9",
        "cache-control": "no-cache",
        "user-agent": "dsh-billing-mini-tag/0.2.0",
      },
    });
    if (!response.ok) throw new Error(`pricing HTTP ${response.status}`);
    const html = await response.text();
    const quote = parseOfficialQuote(html);
    if (quote === null) throw new Error("pricing table not recognised");
    return quote;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* Session usage fold                                                  */
/* ------------------------------------------------------------------ */

/** Non-negative finite number helper. */
function nonNegative(value) {
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) && number > 0 ? number : 0;
}

/**
 * Normalize the four disjoint tokens a provider reports.
 * @returns {number[]|null} `[uncachedInput, output, cacheRead, cacheWrite]`,
 *   or null when the record carries no usable usage.
 */
function usageTokens(usage) {
  if (usage === null || typeof usage !== "object") return null;
  const tokens = [
    nonNegative(usage.inputTokens),
    nonNegative(usage.outputTokens),
    nonNegative(usage.cacheReadTokens),
    nonNegative(usage.cacheWriteTokens),
  ];
  return tokens[0] + tokens[1] + tokens[2] + tokens[3] > 0 ? tokens : null;
}

/** Last provider-reported usage chunk embedded in an assistant stream. */
function lastUsageFromStream(stream) {
  const list = Array.isArray(stream)
    ? stream
    : Array.isArray(stream?.chunks)
      ? stream.chunks
      : null;
  if (list === null) return undefined;
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const chunk = list[index];
    if (chunk !== null && typeof chunk === "object" && chunk.type === "usage" && chunk.usage) {
      return chunk.usage;
    }
  }
  return undefined;
}

/** Provider usage carried by one durable assistant event, if any. */
function usageOf(event) {
  const data = event?.data;
  if (data === null || typeof data !== "object") return undefined;
  if (event.type === "assistant/message" && data.usage !== undefined) return data.usage;
  if (event.type !== "assistant/message" && event.type !== "assistant/attempt") return undefined;
  return lastUsageFromStream(data.stream);
}

/** The model that actually served an assistant event, when it reports one. */
function modelOfEvent(event) {
  const source = event?.data?.message?.source;
  if (source === null || typeof source !== "object") return "";
  return typeof source.model === "string" ? source.model : "";
}

/** Empty per-session fold. */
function createFold() {
  return {
    /** Next durable seq to read. */
    lastSeq: 0,
    /** Latest request-header model, used when an attempt reports no source. */
    headerModel: "",
    /** Step key of the immediately preceding usage event; same key replaces. */
    lastStepKey: "",
    /** One entry per billed attempt: { tokens: number[], model: string, at: number }. */
    entries: [],
  };
}

/**
 * Fold one durable event into a session's usage.
 *
 * `assistant/attempt` and `assistant/message` can both report the same step's
 * usage; the immediate repeat replaces instead of adding. An `llm/retry-started`
 * clears that slot first, so the retried attempt is billed as a second call —
 * matching token-meter's `tokenUsage` projection.
 */
function foldEvent(fold, event) {
  if (event === null || typeof event !== "object") return;

  if (event.type === "request/header") {
    const config = event.data?.header?.config ?? event.data?.config ?? {};
    if (typeof config.model === "string" && config.model !== "") fold.headerModel = config.model;
    return;
  }

  if (event.type === "llm/retry-started") {
    const data = event.data ?? {};
    const key = `${nonNegative(data.turn)}:${nonNegative(data.step)}`;
    if (fold.lastStepKey === key) fold.lastStepKey = "";
    return;
  }

  if (event.type !== "assistant/message" && event.type !== "assistant/attempt") return;

  const tokens = usageTokens(usageOf(event));
  if (tokens === null) return;

  const data = event.data ?? {};
  const key = `${nonNegative(data.turn)}:${nonNegative(data.step)}`;
  const entry = {
    tokens,
    model: modelOfEvent(event) || fold.headerModel || "",
    at: Number.isFinite(event.time) ? event.time : Date.now(),
  };

  if (fold.lastStepKey === key && fold.entries.length > 0) {
    fold.entries[fold.entries.length - 1] = entry;
  } else {
    fold.entries.push(entry);
  }
  fold.lastStepKey = key;
}

/** Map of session id → fold. Bounded, since rebuilding a fold is cheap. */
const folds = new Map();

/** Remember a fold and evict the oldest read when the cache is full. */
function rememberFold(sessionId, fold) {
  if (folds.has(sessionId)) folds.delete(sessionId);
  folds.set(sessionId, fold);
  while (folds.size > MAX_CACHED_SESSIONS) {
    const oldest = folds.keys().next();
    if (oldest.done) break;
    folds.delete(oldest.value);
  }
  return fold;
}

/**
 * Catch one live Session's fold up to its durable tail.
 * @param {object} sessions - the injected `ctx.sessions` service.
 * @param {string} sessionId - Session whose log to fold.
 * @returns {object|null} fold, or null when the Session is not live here.
 */
function foldSession(sessions, sessionId) {
  let session;
  try {
    session = sessions?.get?.(sessionId);
  } catch {
    session = undefined;
  }
  if (session === undefined || session === null) return null;

  let fold = folds.get(sessionId);
  if (fold === undefined) fold = createFold();

  const tail = Math.max(0, Math.floor(Number(session.seq) || 0));
  if (tail < fold.lastSeq) {
    // The log was truncated or forked underneath us: rebuild from zero.
    fold = createFold();
  }

  let seq = fold.lastSeq;
  let guard = 0;
  while (seq < tail && guard < MAX_EVENTS_PER_SYNC) {
    guard += 1;
    let event;
    try {
      event = session.eventAt(seq);
    } catch {
      break;
    }
    if (event === null || event === undefined) break;
    foldEvent(fold, event);
    seq += 1;
  }
  fold.lastSeq = seq;

  return rememberFold(sessionId, fold);
}

/* ------------------------------------------------------------------ */
/* Pricing math                                                        */
/* ------------------------------------------------------------------ */

/** Resolve one provider model id to the model bucket used by the quote. */
function normalizeModelId(model) {
  const id = String(model ?? "").trim().toLowerCase();
  if (id === "") return "";
  if (id.includes("v4-pro") || id.endsWith("/deepseek-pro") || id === "deepseek-pro") {
    return "deepseek-v4-pro";
  }
  if (id.includes("flash")) return "deepseek-flash";
  return id;
}

/**
 * Whether a request time falls in an official peak window.
 * Peak = Beijing time Mon–Fri 09:00–12:00 and 14:00–18:00. Chinese public
 * holidays are not in the quote, so weekday windows are the best local
 * approximation; the two windows are also the only peak facts the page states.
 */
function isPeakTime(at) {
  const timestamp = Number.isFinite(at) ? at : Date.now();
  const beijing = new Date(timestamp + CHINA_OFFSET_MS);
  const day = beijing.getUTCDay();
  if (day === 0 || day === 6) return false;
  const minutes = beijing.getUTCHours() * 60 + beijing.getUTCMinutes();
  return (minutes >= 9 * 60 && minutes < 12 * 60)
    || (minutes >= 14 * 60 && minutes < 18 * 60);
}

/**
 * Price one step under the current quote.
 * @returns {{model: string, known: boolean, peak: boolean, cacheHit: number,
 *   cacheMiss: number, output: number}}
 */
function priceForModel(quote, model, at) {
  const models = quote?.models ?? BUILTIN_MODELS;
  const normalized = normalizeModelId(model);
  const known = Object.prototype.hasOwnProperty.call(models, normalized);
  const bucket = known ? models[normalized] : models["deepseek-flash"] ?? BUILTIN_MODELS["deepseek-flash"];
  const peak = isPeakTime(at);
  const window = peak ? "peak" : "offPeak";
  return {
    model: known ? normalized : "deepseek-flash",
    known,
    peak,
    cacheHit: bucket.cacheHit[window],
    cacheMiss: bucket.cacheMiss[window],
    output: bucket.output[window],
  };
}

/**
 * Total a fold's steps under one quote.
 * @returns {{amount: number, totals: number[], models: object[],
 *   unknownModels: string[]}} unknownModels names routes the quote cannot price
 *   (they fall back to the Flash bucket).
 */
function computeCost(fold, quote) {
  const totals = [0, 0, 0, 0];
  const byModel = new Map();
  const unknown = new Set();
  let amount = 0;

  for (const entry of fold.entries) {
    const price = priceForModel(quote, entry.model, entry.at);
    const [input, output, cacheRead, cacheWrite] = entry.tokens;
    const stepAmount = (
      input * price.cacheMiss
      + output * price.output
      + cacheRead * price.cacheHit
      + cacheWrite * price.cacheMiss
    ) / 1_000_000;

    amount += stepAmount;
    for (let index = 0; index < 4; index += 1) totals[index] += entry.tokens[index];

    const bucket = byModel.get(price.model) ?? {
      model: price.model,
      amount: 0,
      tokens: [0, 0, 0, 0],
      peakSteps: 0,
      offPeakSteps: 0,
      unknown: false,
    };
    bucket.amount += stepAmount;
    for (let index = 0; index < 4; index += 1) bucket.tokens[index] += entry.tokens[index];
    if (price.peak) bucket.peakSteps += 1;
    else bucket.offPeakSteps += 1;
    if (!price.known) {
      bucket.unknown = true;
      unknown.add(String(entry.model || "(unknown)"));
    }
    byModel.set(price.model, bucket);
  }

  return { amount, totals, models: [...byModel.values()], unknownModels: [...unknown] };
}

/** Display helper: the visible tag always keeps exactly two decimals. */
function formatYuan(amount) {
  const number = Number.isFinite(amount) ? amount : 0;
  return `${SYMBOL}${number.toFixed(2)}`;
}

/* ------------------------------------------------------------------ */
/* Plugin wiring                                                       */
/* ------------------------------------------------------------------ */

/** JSON response helper. */
function writeJson(res, status, body) {
  const text = JSON.stringify(body);
  try {
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "content-length": Buffer.byteLength(text),
    });
    res.end(text);
  } catch {
    // The browser closed the tab between request and response.
  }
}

/**
 * Reject cross-site callers. A same-origin page fetch carries
 * `sec-fetch-site: same-origin`; a native local probe carries no header at all
 * and is accepted only from loopback.
 */
function isTrusted(req) {
  try {
    const site = req.headers["sec-fetch-site"];
    if (site !== undefined) return site === "same-origin" || site === "same-site";
    const address = String(req.socket?.remoteAddress ?? "");
    return address === "127.0.0.1"
      || address === "::1"
      || address === "::ffff:127.0.0.1"
      || address.endsWith("127.0.0.1");
  } catch {
    return false;
  }
}

/** Activate the host half. */
export function apply(ctx) {
  let quote = builtinQuote();
  let quoteInFlight = null;
  let quoteQueued = false;
  let quoteLastAttempt = 0;

  /** Metadata for one quote snapshot (the latest by default). */
  function quoteSummary(snapshot = quote) {
    return {
      source: snapshot.source,
      fetchedAt: snapshot.fetchedAt,
      ageMs: snapshot.fetchedAt > 0 ? Math.max(0, Date.now() - snapshot.fetchedAt) : null,
      url: snapshot.url,
      models: Object.keys(snapshot.models),
    };
  }

  /**
   * Pull the official quote once. Concurrent sends share the in-flight request;
   * any send arriving while it runs queues one follow-up fetch, so the quote
   * settles on the newest official page the server was able to read.
   */
  function refreshQuote(reason) {
    if (quoteInFlight !== null) {
      quoteQueued = true;
      return quoteInFlight;
    }
    quoteLastAttempt = Date.now();
    quoteInFlight = (async () => {
      try {
        const next = await fetchOfficialQuote();
        quote = next;
        ctx.logger?.info?.(`billing-mini-tag: official quote refreshed (${reason})`);
      } catch (error) {
        ctx.logger?.warn?.(
          `billing-mini-tag: official quote fetch failed (${reason}): ${String(error?.message ?? error)}`,
        );
      } finally {
        quoteInFlight = null;
        if (quoteQueued) {
          quoteQueued = false;
          void refreshQuote("queued");
        }
      }
      return quote;
    })();
    return quoteInFlight;
  }

  /** Build the zero answer used for a missing Session or an unloaded log. */
  function zeroAnswer(sessionId, snapshot = quote) {
    return {
      ok: true,
      sessionId,
      amount: 0,
      display: formatYuan(0),
      symbol: SYMBOL,
      quote: quoteSummary(snapshot),
      usage: { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      steps: 0,
      models: [],
      unknownModels: [],
    };
  }

  /** One route, always JSON, never leaking an error to the page. */
  function route(path, handler) {
    ctx.effect(() => {
      const dispose = ctx.webServer.register({
        kind: "exact",
        path: `${API}${path}`,
        handler: async (req, res) => {
          if (!isTrusted(req)) {
            writeJson(res, 403, { ok: false, error: "forbidden" });
            return;
          }
          try {
            await handler(req, res);
          } catch (error) {
            writeJson(res, 500, { ok: false, error: String(error?.message ?? error) });
          }
        },
      });
      return dispose;
    }, `billing-mini-tag: route ${API}${path}`);
  }

  route("/cost", async (req, res) => {
    if (req.method !== "GET") {
      writeJson(res, 405, { ok: false, error: "method not allowed" });
      return;
    }

    const url = new URL(req.url ?? `${API}/cost`, "http://127.0.0.1");
    const sessionId = (url.searchParams.get("session") ?? "").trim();

    // Recover from a failed startup fetch when the page is already polling.
    if (quote.source !== "official" && quoteInFlight === null && Date.now() - quoteLastAttempt > QUOTE_RETRY_MS) {
      void refreshQuote("retry");
    }

    if (sessionId === "") {
      writeJson(res, 200, zeroAnswer(""));
      return;
    }

    const fold = foldSession(ctx.sessions, sessionId);
    if (fold === null || fold.entries.length === 0) {
      writeJson(res, 200, zeroAnswer(sessionId));
      return;
    }

    const result = computeCost(fold, quote);
    writeJson(res, 200, {
      ok: true,
      sessionId,
      amount: result.amount,
      display: formatYuan(result.amount),
      symbol: SYMBOL,
      quote: quoteSummary(),
      usage: {
        uncachedInputTokens: result.totals[0],
        outputTokens: result.totals[1],
        cacheReadTokens: result.totals[2],
        cacheWriteTokens: result.totals[3],
      },
      steps: fold.entries.length,
      eventsRead: fold.lastSeq,
      models: result.models,
      unknownModels: result.unknownModels,
    });
  });

  route("/quote", async (req, res) => {
    if (req.method !== "GET") {
      writeJson(res, 405, { ok: false, error: "method not allowed" });
      return;
    }
    writeJson(res, 200, {
      ok: true,
      quote: quoteSummary(),
      prices: quote.models,
      symbol: SYMBOL,
    });
  });

  /**
   * The literal "each send pulls one quote": a user message is the durable
   * trace of pressing Send, so refresh fire-and-forget without delaying the
   * turn. Newer DSH versions pass the appended event as the second listener
   * argument; the session log read is a fallback for older signatures.
   */
  ctx.on("session/event", (session, event) => {
    let type = event?.type;
    if (type === undefined) {
      try {
        const seq = Math.max(0, Math.floor(Number(session?.seq) || 0));
        type = seq > 0 ? session.eventAt(seq - 1)?.type : undefined;
      } catch {
        type = undefined;
      }
    }
    if (type === "user/message") void refreshQuote("send");
  });

  // Prime the quote so a page loaded into an existing Session shows a real
  // amount before the next Send.
  void refreshQuote("startup");
  ctx.logger?.debug?.("billing-mini-tag: host ready; cost route mounted");
}
