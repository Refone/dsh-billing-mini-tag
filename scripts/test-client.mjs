#!/usr/bin/env node
/**
 * Browser-half smoke test.
 *
 * `src/client.js` is not a normal module: it hands a factory to
 * `window.__ModuleLoader__`. This script stubs that loader and React, runs
 * `apply()` against a fake Cordis context, and inspects what the GUI would
 * receive: the `conversation.composer.dock` entry with its `¥x.xx` contract and
 * a tooltip in the reader's language.
 *
 * The fake context answers `ctx.get()` with `undefined`: DSH's dynamic-plugin
 * facade treats it as an optional lookup, and the fiber activates on `slots`
 * before the locale plugin provides its service. Only an injected `locale`
 * seat is guaranteed, which is what the plugin must use — looking it up with
 * `ctx.get("locale")` silently leaves the dictionary unregistered and every
 * string falls back to its raw key.
 *
 * No dependencies: run with `node scripts/test-client.mjs`.
 */

import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Minimal React stub: elements are plain objects, state never updates. */
const react = {
  createElement(type, props, ...children) {
    return {
      type,
      props: { ...(props ?? {}), children: children.length === 1 ? children[0] : children },
    };
  },
  useState(initial) {
    return [initial, () => {}];
  },
  useRef(value) {
    return { current: value };
  },
  useEffect() {},
};

let loaded;
globalThis.window = {
  __ModuleLoader__: {
    load(entry) {
      loaded = entry.factory((request) => {
        assert.equal(request, "react", `unexpected require(${JSON.stringify(request)})`);
        return react;
      });
    },
  },
};

await import(pathToFileURL(join(root, "src/client.js")).href);
assert.equal(typeof loaded.apply, "function", "client exports apply()");
assert.ok(loaded.inject.includes("slots"), "client injects the slots service");
assert.ok(loaded.inject.includes("locale"), "client injects the locale service");

/**
 * A locale runtime with the real lookup shape: namespaces hold one dictionary
 * per language, `bind()` resolves through the active language to English and
 * finally to the key itself.
 *
 * @param {string} active - active language id.
 * @returns {object} register / bind / getSnapshot / subscribe.
 */
function createLocale(active = "en") {
  const dictionaries = new Map();
  const bound = new Map();
  const snapshot = { active, revision: 0 };
  return {
    register(namespace, localeOrDictionaries, dictionary) {
      const pairs = typeof localeOrDictionaries === "string"
        ? [[localeOrDictionaries, dictionary]]
        : Object.entries(localeOrDictionaries);
      let locales = dictionaries.get(namespace);
      if (locales === undefined) {
        locales = new Map();
        dictionaries.set(namespace, locales);
      }
      for (const [language, entries] of pairs) {
        assert.ok(!locales.has(language), `namespace "${namespace}" already has "${language}"`);
        locales.set(language, entries);
      }
      snapshot.revision += 1;
      return () => {
        for (const [language] of pairs) locales.delete(language);
        snapshot.revision += 1;
      };
    },
    bind(namespace) {
      let translate = bound.get(namespace);
      if (translate === undefined) {
        translate = (key, params) => {
          const locales = dictionaries.get(namespace);
          const template = locales?.get(snapshot.active)?.[key] ?? locales?.get("en")?.[key] ?? key;
          if (params === undefined) return template;
          return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
        };
        bound.set(namespace, translate);
      }
      return translate;
    },
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
  };
}

/**
 * Run apply() against the dynamic-plugin facade DSH builds: declared services
 * on `ctx`, optional lookup through `ctx.get()`.
 *
 * @param {object} locale - the injected locale service.
 * @returns {Array<{options: object, component: Function}>} slot registrations.
 */
function boot(locale) {
  const registrations = [];
  loaded.apply({
    locale,
    // The fiber activates on `slots`; the locale provider may not be up yet, so
    // an optional lookup here legitimately answers nothing.
    get: () => undefined,
    effect: (run) => {
      run();
    },
    slots: {
      inject: (_name, run) => run(),
      register: (options, component) => {
        registrations.push({ options, component });
      },
    },
  });
  return registrations;
}

/** Resolve the wrapper component a slot entry returns, as React would. */
function call(component, props) {
  const element = component(props);
  return typeof element.type === "function" ? element.type(element.props) : element;
}

// --- registration --------------------------------------------------------
const registrations = boot(createLocale("en"));
assert.equal(registrations.length, 1, "the browser half registers exactly one slot entry");
const dock = registrations[0];
assert.equal(dock.options.name, "conversation.composer.dock");
assert.equal(dock.options.id, "billing-mini-tag");
assert.equal(dock.options.order, 2);

// --- dictionaries --------------------------------------------------------
const en = createLocale("en");
boot(en);
assert.equal(
  en.bind("billing-mini-tag")("cost.title"),
  "Current session spend {amount} · {source}",
  "apply registers the English dictionary",
);
const zh = createLocale("zh");
boot(zh);
assert.equal(zh.bind("billing-mini-tag")("cost.unknown"), "未知模型按 Flash 价估算", "apply registers the Chinese dictionary");

// --- the pill ------------------------------------------------------------
const CONTRACT = {
  en: "Current session spend ¥0.00",
  zh: "当前会话消费 ¥0.00",
};

for (const [language, title] of Object.entries(CONTRACT)) {
  const locale = createLocale(language);
  const entry = boot(locale)[0];
  const pill = call(entry.component, { sessionId: "session-1", t: locale.bind("billing-mini-tag") });

  assert.equal(pill.props["data-composer-stat"], "billing-mini-tag");
  assert.equal(pill.props.children.props.children, "¥0.00", `${language} pill shows ¥0.00 without a reading`);
  assert.equal(pill.props.children.props["data-billing-amount"], "0.0000");
  assert.equal(pill.props.children.props.title, title, `${language} tooltip is translated`);
  assert.equal(pill.props.children.props["aria-label"], title, `${language} aria-label is translated`);
}

console.log("client smoke test passed (1 registration, 2 locales)");
