/**
 * Browser-half tests for dsh-liaobots-balance.
 *
 * Loads lib/client.js the way the DSH web GUI does — through
 * window.__ModuleLoader__.load — into a jsdom document, then mounts the
 * registered sidebar card with React and a stubbed fetch, so the data flow
 * (host route → state → card/popover markup), the compact-rail behaviour, the
 * locale dictionaries and the error path are all exercised for real.
 *
 * Usage:  node test/client.test.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import React from "react";
import ReactDOM from "react-dom";
import { createRoot } from "react-dom/client";

let failures = 0;
let passed = 0;
async function test(title, body) {
	try {
		await body();
		passed += 1;
		console.log(`  ok   ${title}`);
	} catch (error) {
		failures += 1;
		console.log(`  FAIL ${title}\n       ${error instanceof Error ? error.message : String(error)}`);
	}
}

const act = React.act;

/** Fresh jsdom + a fresh evaluation of the client bundle. */
function loadPlugin() {
	const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
		url: "http://127.0.0.1:19387/",
		pretendToBeVisual: true
	});
	globalThis.window = dom.window;
	globalThis.document = dom.window.document;
	globalThis.IS_REACT_ACT_ENVIRONMENT = true;

	const code = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
	let definition;
	dom.window.__ModuleLoader__ = { load: (value) => { definition = value; } };
	// The bundle is a plain script that hands its factory to the loader.
	new Function("window", code)(dom.window);
	assert.ok(definition !== void 0, "the bundle called __ModuleLoader__.load");

	const primitives = {
		Tooltip: ({ label, children }) => React.createElement("span", { "data-tooltip": label }, children),
		IconRefreshOutlineRegular: (props) => React.createElement("svg", { "data-icon": "refresh", ...props })
	};
	const plugin = definition.factory((id) => {
		if (id === "react") return React;
		if (id === "react-dom") return ReactDOM;
		if (id === "react/jsx-runtime") return { jsx: React.createElement, jsxs: React.createElement, Fragment: React.Fragment };
		if (id === "@deepseek-ai/dsh-client-ui-primitives") return primitives;
		throw new Error(`unexpected require(${id})`);
	});
	return { dom, definition, plugin };
}

/** Client ctx stub that records what the plugin registers. */
function makeClientCtx() {
	const registrations = { locales: {}, seat: void 0, component: void 0, injectName: void 0, effectLabels: [] };
	const ctx = {
		effect(fn, label) {
			registrations.effectLabels.push(label);
			return fn();
		},
		locale: {
			register(namespace, dictionaries) {
				registrations.locales[namespace] = dictionaries;
				return () => {};
			}
		},
		slots: {
			inject(name, run) {
				registrations.injectName = name;
				run();
			},
			register(seat, component) {
				registrations.seat = seat;
				registrations.component = component;
				return () => {};
			}
		}
	};
	return { ctx, registrations };
}

/** Locale function backed by the plugin's own zh dictionary. */
function makeT(registrations) {
	const dict = registrations.locales["liaobots-balance"].zh;
	return (key, params) => {
		let value = dict[key] ?? key;
		if (params !== void 0) {
			for (const [name, replacement] of Object.entries(params)) {
				value = value.replace(`{${name}}`, String(replacement));
			}
		}
		return value;
	};
}

function jsonResponse(status, body) {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: async () => body
	};
}

const BALANCE_PAYLOAD = {
	ok: true,
	balance: 85.5,
	amount: 100,
	used: 14.5,
	remainingRatio: 0.855,
	host: "https://ai.liaobots1.work",
	lowThreshold: 5,
	criticalThreshold: 1,
	topUpURL: "https://liaobots.work"
};
const USAGE_PAYLOAD = {
	ok: true,
	balance: 85.5,
	amount: 100,
	usage: {
		pageSize: 6,
		nextId: null,
		list: [
			{ id: 1, model: "gpt-6-luna", price: 0.12, tokens: 1200, createdAt: Date.UTC(2026, 9, 1, 12, 30) },
			{ id: 2, model: "claude-fable-5-with-a-very-long-model-name", price: 0.3, tokens: 900, createdAt: Date.UTC(2026, 9, 1, 12, 40) }
		]
	}
};

/** Mount the card with a fetch stub and return handles for assertions. */
async function mount(registrations, { wide = true, payload = BALANCE_PAYLOAD, status = 200, onFetch } = {}) {
	const dom = globalThis.window;
	const requests = [];
	globalThis.fetch = async (url) => {
		requests.push(url);
		if (onFetch !== void 0) return onFetch(url);
		if (url.startsWith("/api/dsh-liaobots/balance")) return jsonResponse(status, payload);
		if (url.startsWith("/api/dsh-liaobots/usage")) return jsonResponse(200, USAGE_PAYLOAD);
		throw new Error(`unexpected fetch ${url}`);
	};
	const container = dom.document.createElement("div");
	// Mimic the DSH sidebar footer slot: a flex row that hosts the cards.
	container.style.display = "flex";
	container.style.flexDirection = "row";
	dom.document.body.appendChild(container);
	const root = createRoot(container);
	const t = makeT(registrations);
	await act(async () => {
		root.render(React.createElement(registrations.component, { wide, t }));
	});
	/** Let the mount-time balance fetch settle before assertions. */
	await settle();
	return {
		container,
		root,
		requests,
		body: () => dom.document.body.textContent,
		click: async (element) => {
			await act(async () => {
				element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
			});
			await settle();
		}
	};
}

/** Flush pending microtasks and timer turns inside act(). */
async function settle() {
	for (let turn = 0; turn < 3; turn += 1) {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
	}
}

/** ---------------------------------------------------------------- tests */

console.log("dsh-liaobots-balance browser half");

const base = loadPlugin();

await test("the bundle registers itself with the loader under the package id", () => {
	assert.equal(base.definition.id, "dsh-liaobots-balance");
	assert.equal(typeof base.definition.factory, "function");
	assert.equal(typeof base.plugin.apply, "function");
	assert.deepEqual(base.plugin.inject, ["slots", "locale"]);
});

await test("apply() seats the card in the sidebar footer with its own locale", () => {
	const { ctx, registrations } = makeClientCtx();
	base.plugin.apply(ctx);
	assert.equal(registrations.injectName, "sidebar.footer.action");
	assert.equal(registrations.seat.name, "sidebar.footer.action");
	assert.equal(registrations.seat.id, "liaobots-balance");
	assert.equal(registrations.seat.order, 20);
	assert.equal(registrations.seat.locale, "liaobots-balance");
	assert.equal(typeof registrations.component, "function");
	assert.deepEqual(registrations.effectLabels, ["dsh-liaobots-balance: dictionaries"]);
});

await test("zh and en dictionaries cover the same keys", () => {
	const { ctx, registrations } = makeClientCtx();
	base.plugin.apply(ctx);
	const dictionaries = registrations.locales["liaobots-balance"];
	assert.deepEqual(Object.keys(dictionaries.en).sort(), Object.keys(dictionaries.zh).sort());
});

await test("the stylesheet is injected once, tagged for the plugin", () => {
	const tag = globalThis.document.querySelector('style[data-plugin-css="dsh-liaobots-balance/styles.css"]');
	assert.ok(tag !== null, "style tag present");
	assert.equal(tag.dataset.plugin, "dsh-liaobots-balance");
	assert.ok(tag.textContent.includes(".dshlb_sidePop"));
	assert.ok(tag.textContent.includes(".dshlb_brandMini"));
	// Card metrics mirror dsh-balance-widget.
	assert.ok(tag.textContent.includes("border-radius:12px"));
	assert.ok(tag.textContent.includes("background:var(--dsw-alias-interactive-bg-hover)"));
});

await test("the card shows the balance, the brand label and the total quota", async () => {
	const { ctx, registrations } = makeClientCtx();
	base.plugin.apply(ctx);
	const view = await mount(registrations);
	const text = view.container.textContent;
	assert.ok(text.includes("LB账户余额"), `brand missing in: ${text}`);
	assert.ok(text.includes("85.5"), `balance missing in: ${text}`);
	assert.ok(text.includes("总积分"), `footer label missing in: ${text}`);
	assert.ok(text.includes("100"), `total quota missing in: ${text}`);
	// Amount is split into int/dec spans for the enlarged leading digits.
	assert.ok(view.container.querySelector(".dshlb_int") !== null);
	assert.ok(view.container.querySelector(".dshlb_dec") !== null);
	assert.ok(view.container.querySelector(".dshlb_brandMini").textContent === "LB");
	assert.equal(view.container.querySelector("[data-compact]"), null);
	const amount = view.container.querySelector(".dshlb_sideAmount");
	assert.equal(amount.getAttribute("data-level"), null, "healthy balance carries no warning level");
	assert.ok(view.requests.some((url) => url === "/api/dsh-liaobots/balance"));
	await act(async () => { view.root.unmount(); });
});

await test("clicking the card opens the popover with quota and spending", async () => {
	const { ctx, registrations } = makeClientCtx();
	base.plugin.apply(ctx);
	const view = await mount(registrations);
	await view.click(view.container.querySelector("button"));
	const text = view.body();
	for (const expected of ["剩余积分", "85.5", "总积分", "已用积分", "14.5", "最近扣费"]) {
		assert.ok(text.includes(expected), `popover missing ${expected} in: ${text}`);
	}
	// The remaining/total ratio and its bar were removed: they said nothing the
	// two amounts above do not already say.
	assert.ok(!text.includes("剩余占比"), `ratio row must be gone in: ${text}`);
	assert.equal(globalThis.document.querySelector(".dshlb_bar"), null, "ratio bar must be gone");
	assert.equal(globalThis.document.querySelector(".dshlb_barFill"), null);
	await act(async () => { view.root.unmount(); });
});

await test("recent deductions are listed with model, price and time", async () => {
	const { ctx, registrations } = makeClientCtx();
	base.plugin.apply(ctx);
	const view = await mount(registrations);
	await view.click(view.container.querySelector("button"));
	const text = view.body();
	assert.ok(text.includes("gpt-6-luna"), `model row missing in: ${text}`);
	assert.ok(text.includes("-0.12"), `price missing in: ${text}`);
	assert.ok(text.includes("claude-fable-5"), `second row missing in: ${text}`);
	assert.ok(text.includes("10-01") || text.includes("09-30"), `timestamp missing in: ${text}`);
	assert.ok(view.requests.some((url) => url.startsWith("/api/dsh-liaobots/usage?pageSize=")));
	// The gateway that answered is shown, so a mirror failover is visible.
	assert.ok(text.includes("https://ai.liaobots1.work/api/v1/credits"));
	await act(async () => { view.root.unmount(); });
});

await test("collapsed sidebar renders the compact rail variant", async () => {
	const { ctx, registrations } = makeClientCtx();
	base.plugin.apply(ctx);
	const view = await mount(registrations, { wide: false });
	const wrap = view.container.querySelector(".dshlb_sideWrap");
	assert.equal(wrap.getAttribute("data-compact"), "true");
	await act(async () => { view.root.unmount(); });
});

await test("a balance below 1 switches to the error level and warns", async () => {
	const { ctx, registrations } = makeClientCtx();
	base.plugin.apply(ctx);
	const view = await mount(registrations, {
		payload: { ...BALANCE_PAYLOAD, balance: 0.8, used: 99.2 }
	});
	const amount = view.container.querySelector(".dshlb_sideAmount");
	assert.equal(amount.getAttribute("data-level"), "2");
	await view.click(view.container.querySelector("button"));
	const text = view.body();
	assert.ok(text.includes("剩余积分即将耗尽"), `warning missing in: ${text}`);
	// The ratio payload still arrives, but nothing renders a bar from it.
	assert.equal(globalThis.document.querySelector(".dshlb_barFill"), null);
	await act(async () => { view.root.unmount(); });
});

await test("a balance below 5 uses the warn level", async () => {
	const { ctx, registrations } = makeClientCtx();
	base.plugin.apply(ctx);
	const view = await mount(registrations, {
		payload: { ...BALANCE_PAYLOAD, balance: 4.5, used: 95.5 }
	});
	assert.equal(view.container.querySelector(".dshlb_sideAmount").getAttribute("data-level"), "1");
	await view.click(view.container.querySelector("button"));
	assert.ok(view.body().includes("剩余积分偏低"));
	await act(async () => { view.root.unmount(); });
});

await test("colour thresholds sit on the balance boundary: 5 is normal, 1 is yellow, below 1 is red", async () => {
	const { ctx, registrations } = makeClientCtx();
	base.plugin.apply(ctx);
	const level = async (balance) => {
		const view = await mount(registrations, { payload: { ...BALANCE_PAYLOAD, balance, used: 100 - balance } });
		const attr = view.container.querySelector(".dshlb_sideAmount").getAttribute("data-level");
		await act(async () => { view.root.unmount(); });
		return attr;
	};
	assert.equal(await level(5), null, "5 is not below the warn threshold");
	assert.equal(await level(1), "1", "1 is below 5 but not below 1");
	assert.equal(await level(0.99), "2", "below 1 turns red");
});

await test("a gateway failure surfaces the host error inside the popover", async () => {
	const { ctx, registrations } = makeClientCtx();
	base.plugin.apply(ctx);
	const view = await mount(registrations, {
		status: 502,
		payload: { ok: false, code: "auth", error: "登录码无效：user not found（请检查 LIAO_API_KEY）" }
	});
	assert.ok(view.container.textContent.includes("—"), "no balance shown while failing");
	await view.click(view.container.querySelector("button"));
	assert.ok(view.body().includes("登录码无效"), `error missing in: ${view.body()}`);
	assert.ok(view.body().includes("请检查 LIAO_API_KEY"));
	await act(async () => { view.root.unmount(); });
});

await test("the refresh button re-queries the host routes", async () => {
	const { ctx, registrations } = makeClientCtx();
	base.plugin.apply(ctx);
	const view = await mount(registrations);
	await view.click(view.container.querySelector("button"));
	const before = view.requests.length;
	const refresh = globalThis.document.querySelector(".dshlb_sidePopRefresh");
	assert.ok(refresh !== null, "refresh button rendered");
	await view.click(refresh);
	assert.ok(view.requests.length > before, "refresh triggered new requests");
	await act(async () => { view.root.unmount(); });
});

await test("the popover closes on an outside click and unmounts cleanly", async () => {
	const { ctx, registrations } = makeClientCtx();
	base.plugin.apply(ctx);
	const view = await mount(registrations);
	await view.click(view.container.querySelector("button"));
	assert.ok(globalThis.document.querySelector(".dshlb_sidePop") !== null);
	await act(async () => {
		globalThis.document.body.dispatchEvent(new globalThis.window.MouseEvent("mousedown", { bubbles: true }));
	});
	assert.equal(globalThis.document.querySelector(".dshlb_sidePop"), null);
	await act(async () => { view.root.unmount(); });
});

await test("the popover stays usable when the gateway sends no usage block", async () => {
	const { ctx, registrations } = makeClientCtx();
	base.plugin.apply(ctx);
	const view = await mount(registrations, {
		onFetch: (url) => (url.startsWith("/api/dsh-liaobots/balance")
			? jsonResponse(200, BALANCE_PAYLOAD)
			: jsonResponse(200, { ok: true, balance: 85.5, amount: 100 }))
	});
	await view.click(view.container.querySelector("button"));
	assert.ok(view.body().includes("暂无扣费记录"), `empty state missing in: ${view.body()}`);
	await act(async () => { view.root.unmount(); });
});

await test("the interval sent by the host drives the polling timer", async () => {
	const { ctx, registrations } = makeClientCtx();
	base.plugin.apply(ctx);
	const delays = [];
	const realSetInterval = globalThis.setInterval;
	globalThis.setInterval = (fn, delay) => {
		delays.push(delay);
		return realSetInterval(fn, 1 << 30);
	};
	try {
		const view = await mount(registrations, { payload: { ...BALANCE_PAYLOAD, refreshIntervalMs: 30000 } });
		assert.ok(delays.includes(30000), `expected a 30s timer, saw: ${delays.join(", ")}`);
		await act(async () => { view.root.unmount(); });
	} finally {
		globalThis.setInterval = realSetInterval;
	}
});

await test("the card stacks under its sibling: full line + wrapped footer row", async () => {
	const { ctx, registrations } = makeClientCtx();
	base.plugin.apply(ctx);
	const view = await mount(registrations);
	const wrap = view.container.querySelector(".dshlb_sideWrap");
	assert.equal(wrap.getAttribute("data-stack"), "true");
	assert.equal(view.container.style.flexWrap, "wrap", "the shell-owned footer row is told to wrap");
	// The stylesheet claims a whole line for the stacked card, but the collapsed
	// rail still wins (compact rule comes later in the sheet).
	const css = globalThis.document.querySelector('style[data-plugin-css="dsh-liaobots-balance/styles.css"]').textContent;
	const stacked = css.indexOf('.dshlb_sideWrap[data-stack="true"]{flex:1 1 100%}');
	const compact = css.indexOf('.dshlb_sideWrap[data-compact="true"]{flex:0 0 auto}');
	assert.ok(stacked !== -1, "stacked flex rule present");
	assert.ok(compact > stacked, "compact rule must come after the stacked rule");
	await act(async () => { view.root.unmount(); });
	assert.equal(view.container.style.flexWrap, "", "the row is restored on unmount");
});

await test("stackCards:false keeps the card inline with its sibling", async () => {
	const { ctx, registrations } = makeClientCtx();
	base.plugin.apply(ctx);
	const view = await mount(registrations, { payload: { ...BALANCE_PAYLOAD, stackCards: false } });
	const wrap = view.container.querySelector(".dshlb_sideWrap");
	assert.equal(wrap.getAttribute("data-stack"), null);
	assert.equal(view.container.style.flexWrap, "", "the row is left alone");
	await act(async () => { view.root.unmount(); });
});

await test("a missing Tooltip primitive degrades without throwing", async () => {
	const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://127.0.0.1:19387/" });
	globalThis.window = dom.window;
	globalThis.document = dom.window.document;
	const code = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
	let definition;
	dom.window.__ModuleLoader__ = { load: (value) => { definition = value; } };
	new Function("window", code)(dom.window);
	const plugin = definition.factory((id) => {
		if (id === "react") return React;
		if (id === "react-dom") return ReactDOM;
		if (id === "react/jsx-runtime") return { jsx: React.createElement, jsxs: React.createElement, Fragment: React.Fragment };
		// Primitives without any refresh glyph: the local SVG fallback must render.
		if (id === "@deepseek-ai/dsh-client-ui-primitives") return {};
		throw new Error(`unexpected require(${id})`);
	});
	const { ctx, registrations } = makeClientCtx();
	plugin.apply(ctx);
	const view = await mount(registrations);
	await view.click(view.container.querySelector("button"));
	const refresh = globalThis.document.querySelector(".dshlb_sidePopRefresh");
	assert.ok(refresh !== null);
	assert.ok(refresh.querySelector("svg") !== null, "local refresh glyph fallback rendered");
	await act(async () => { view.root.unmount(); });
});

console.log(`\n${passed} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
