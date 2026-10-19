/**
 * Host-half tests for dsh-liaobots-balance.
 *
 * Runs the real route handlers against a stubbed ctx and a stubbed global
 * fetch, so route wiring, the loopback fence, credential resolution, response
 * parsing, host failover, error classification and caching are all exercised
 * without a running DSH host and without the user's login code.
 *
 * Usage:  node test/host.test.mjs          (stubbed gateway)
 *         node test/host.test.mjs --live   (also probes the real gateway)
 */
import assert from "node:assert/strict";

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

/** Import a pristine copy of the host module (module state is per-instance). */
let generation = 0;
function freshModule() {
	generation += 1;
	return import(`../lib/index.js?gen=${generation}`);
}

/** Stub ctx that records routes and exposes credentials/env/tools seams. */
function makeCtx(options = {}) {
	const routes = [];
	const logs = [];
	return {
		routes,
		logs,
		get(name) {
			if (name === "credentials") {
				if (options.authCode === void 0) return void 0;
				return { resolve: async () => ({ value: options.authCode }) };
			}
			if (name === "launchEnvironment") {
				if (options.launchEnv === void 0) return void 0;
				return { get: () => ({ value: options.launchEnv }) };
			}
			// The real context resolves optional services through ctx.get(); the
			// plugin must never read an undeclared service as a property.
			if (name === "tools") return options.tools;
			return void 0;
		},
		logger: { info: (...args) => logs.push(args.join(" ")), warn: (...args) => logs.push(args.join(" ")) },
		webServer: {
			register(route) {
				routes.push(route);
				return () => {};
			}
		},
		tools: options.tools
	};
}

/**
 * Mimic the Cordis service proxy: reading an undeclared service throws, so a
 * plugin that reads `ctx.tools` instead of `ctx.get("tools")` fails to apply.
 */
function guardUndeclaredServices(ctx, declared = ["webServer"]) {
	const own = new Map(Object.entries(ctx));
	for (const name of ["tools", "credentials", "launchEnvironment", "userQuestions", "fs"]) {
		if (declared.includes(name) || !own.has(name)) continue;
		Object.defineProperty(ctx, name, {
			configurable: true,
			get() {
				throw new Error(`cannot get property "${name}" without inject`);
			}
		});
	}
	return ctx;
}

function makeRequest(url, method = "GET", remoteAddress = "::ffff:127.0.0.1") {
	return { url, method, socket: { remoteAddress } };
}

function makeResponse() {
	return {
		statusCode: 0,
		headers: void 0,
		body: void 0,
		writeHead(status, headers) {
			this.statusCode = status;
			this.headers = headers;
		},
		end(payload) {
			this.body = payload;
		},
		json() {
			return JSON.parse(this.body);
		}
	};
}

/** Route lookup by path. */
function routeOf(module, path) {
	const route = module.API && Object.values(module.API).includes(path)
		? path
		: path;
	return route;
}

/** The real fetch, kept for the optional live probe. */
const realFetch = globalThis.fetch;

/** Install a stubbed fetch; returns the recorded calls. */
function stubFetch(handler) {
	const calls = [];
	globalThis.fetch = async (url, init) => {
		calls.push({ url, init });
		return handler(url, init, calls.length);
	};
	return calls;
}

/** Minimal Response stand-in. */
function response(status, body) {
	return {
		ok: status >= 200 && status < 300,
		status,
		text: async () => (typeof body === "string" ? body : JSON.stringify(body))
	};
}

const DOCUMENTED_PAYLOAD = { data: { balance: 85.5, amount: 100.0 } };
const USAGE_PAYLOAD = {
	data: {
		balance: 85.5,
		amount: 100,
		usage: {
			pageSize: 2,
			nextId: "1234567890",
			list: [
				{ id: 1, model: "gpt-6-luna", price: 0.12, tokens: 1200, input_tokens: 800, output_tokens: 400, create_time: 1760000000000 },
				{ id: 2, model: "claude-fable-5", price: 0.3, tokens: 900, input_tokens: 500, output_tokens: 400, create_time: 1760000100000 }
			]
		}
	}
};

async function callBalance(module, ctx, url = module.API.balance) {
	const route = ctx.routes.find((entry) => entry.path === url);
	assert.ok(route !== void 0, `route ${url} registered`);
	const res = makeResponse();
	await route.handler(makeRequest(url), res);
	return res;
}

/** ------------------------------------------------------------------ tests */

console.log("dsh-liaobots-balance host half");

await test("apply() registers both loopback routes and logs the base URL", async () => {
	const module = await freshModule();
	const ctx = makeCtx({ authCode: "sk-test" });
	module.apply(ctx, void 0);
	assert.deepEqual(ctx.routes.map((r) => r.path), [module.API.balance, module.API.usage]);
	assert.ok(ctx.routes.every((r) => r.kind === "exact"));
});

await test("non-loopback callers are fenced out with 403", async () => {
	const module = await freshModule();
	const ctx = makeCtx({ authCode: "sk-test" });
	module.apply(ctx, void 0);
	const route = ctx.routes[0];
	const res = makeResponse();
	await route.handler(makeRequest(module.API.balance, "GET", "192.168.1.20"), res);
	assert.equal(res.statusCode, 403);
	assert.match(res.json().error, /loopback-only/);
});

await test("a non-GET method is rejected with 405", async () => {
	const module = await freshModule();
	const ctx = makeCtx({ authCode: "sk-test" });
	module.apply(ctx, void 0);
	const res = makeResponse();
	await ctx.routes[0].handler(makeRequest(module.API.balance, "POST"), res);
	assert.equal(res.statusCode, 405);
});

await test("missing login code answers 400 no-credentials without touching the network", async () => {
	const module = await freshModule();
	const ctx = makeCtx({});
	const calls = stubFetch(() => response(200, DOCUMENTED_PAYLOAD));
	module.apply(ctx, void 0);
	const res = await callBalance(module, ctx);
	assert.equal(res.statusCode, 400);
	assert.equal(res.json().code, "no-credentials");
	assert.equal(calls.length, 0);
});

await test("documented payload maps to balance/amount/used/remainingRatio", async () => {
	const module = await freshModule();
	const ctx = makeCtx({ authCode: "sk-test" });
	stubFetch(() => response(200, DOCUMENTED_PAYLOAD));
	module.apply(ctx, { baseURL: "https://gateway.example" });
	const res = await callBalance(module, ctx);
	const body = res.json();
	assert.equal(res.statusCode, 200);
	assert.equal(body.ok, true);
	assert.equal(body.balance, 85.5);
	assert.equal(body.amount, 100);
	assert.equal(body.used, 14.5);
	assert.equal(body.remainingRatio, 0.855);
	assert.equal(body.host, "https://gateway.example");
	assert.equal(body.lowThreshold, 5);
	assert.equal(body.criticalThreshold, 1);
	assert.equal(body.topUpURL, "https://liaobots.work");
	assert.equal(body.stackCards, true, "stacked sidebar layout is the default");
	assert.ok(typeof body.fetchedAt === "number");
});

await test("the request carries the documented path and Bearer header", async () => {
	const module = await freshModule();
	const ctx = makeCtx({ authCode: "sk-secret-code" });
	const calls = stubFetch(() => response(200, DOCUMENTED_PAYLOAD));
	module.apply(ctx, { baseURL: "https://gateway.example/" });
	await callBalance(module, ctx);
	assert.equal(calls.length, 1);
	assert.equal(calls[0].url, "https://gateway.example/api/v1/credits");
	assert.equal(calls[0].init.headers.authorization, "Bearer sk-secret-code");
	assert.equal(calls[0].init.headers.accept, "application/json");
});

await test("balance stays out of the browser payload: no key or raw body leaks", async () => {
	const module = await freshModule();
	const ctx = makeCtx({ authCode: "sk-secret-code" });
	stubFetch(() => response(200, { data: { balance: 1, amount: 2, token: "sk-leak" } }));
	module.apply(ctx, { baseURL: "https://gateway.example" });
	const res = await callBalance(module, ctx);
	assert.equal(res.body.includes("sk-secret-code"), false);
	assert.equal(res.body.includes("sk-leak"), false);
});

await test("404 user-not-found is classified as an invalid login code", async () => {
	const module = await freshModule();
	const ctx = makeCtx({ authCode: "sk-wrong" });
	stubFetch(() => response(404, { error: "user not found" }));
	module.apply(ctx, { baseURL: "https://gateway.example" });
	const res = await callBalance(module, ctx);
	assert.equal(res.statusCode, 502);
	assert.equal(res.json().code, "auth");
	assert.match(res.json().error, /登录码无效/);
});

await test("401 is classified as an auth failure", async () => {
	const module = await freshModule();
	const ctx = makeCtx({ authCode: "sk-wrong" });
	stubFetch(() => response(401, { error: "unauthorized" }));
	module.apply(ctx, { baseURL: "https://gateway.example" });
	const res = await callBalance(module, ctx);
	assert.equal(res.json().code, "auth");
});

await test("a broken host falls over to the next candidate and stays sticky", async () => {
	const module = await freshModule();
	const ctx = makeCtx({ authCode: "sk-test" });
	const seen = [];
	const calls = stubFetch((url) => {
		seen.push(url);
		if (url.startsWith("https://dead.example")) {
			const error = new Error("connect timeout");
			error.cause = { code: "UND_ERR_CONNECT_TIMEOUT" };
			throw error;
		}
		return response(200, DOCUMENTED_PAYLOAD);
	});
	module.apply(ctx, {
		baseURL: "https://dead.example",
		fallbackBaseURLs: ["https://alive.example"]
	});
	const first = await callBalance(module, ctx);
	assert.equal(first.statusCode, 200);
	assert.equal(first.json().host, "https://alive.example");
	assert.deepEqual(seen, ["https://dead.example/api/v1/credits", "https://alive.example/api/v1/credits"]);
	// The host that answered is tried first next time (no repeated dead-host
	// wait). The balance answer is still cached, so ask the usage route, whose
	// cache key differs and therefore hits the network again.
	const usageRoute = ctx.routes.find((entry) => entry.path === module.API.usage);
	await usageRoute.handler(makeRequest(module.API.usage), makeResponse());
	assert.equal(seen[2], "https://alive.example/api/v1/credits?include_usage=true&pageSize=10");
});

await test("all hosts down yields a 502 unreachable error naming each failure", async () => {
	const module = await freshModule();
	const ctx = makeCtx({ authCode: "sk-test" });
	stubFetch(() => {
		const error = new Error("nope");
		error.cause = { code: "ENOTFOUND" };
		throw error;
	});
	module.apply(ctx, { baseURL: "https://a.example", fallbackBaseURLs: ["https://b.example"] });
	const res = await callBalance(module, ctx);
	const body = res.json();
	assert.equal(res.statusCode, 502);
	assert.equal(body.code, "unreachable");
	assert.match(body.error, /a\.example 域名解析失败/);
	assert.match(body.error, /b\.example 域名解析失败/);
});

await test("balance answers are cached for the auto-refresh interval", async () => {
	const module = await freshModule();
	const ctx = makeCtx({ authCode: "sk-test" });
	const calls = stubFetch(() => response(200, DOCUMENTED_PAYLOAD));
	module.apply(ctx, { baseURL: "https://gateway.example" });
	const first = await callBalance(module, ctx);
	const second = await callBalance(module, ctx);
	assert.equal(calls.length, 1);
	assert.equal(first.json().cached, false);
	assert.equal(second.json().cached, true);
	assert.equal(second.json().balance, 85.5);
});

await test("usage route returns normalized rows and the next page cursor", async () => {
	const module = await freshModule();
	const ctx = makeCtx({ authCode: "sk-test" });
	const calls = stubFetch(() => response(200, USAGE_PAYLOAD));
	module.apply(ctx, { baseURL: "https://gateway.example", usagePageSize: 2 });
	const route = ctx.routes.find((entry) => entry.path === module.API.usage);
	const res = makeResponse();
	await route.handler(makeRequest(`${module.API.usage}?pageSize=2`), res);
	const body = res.json();
	assert.equal(body.ok, true);
	assert.equal(body.usage.list.length, 2);
	assert.equal(body.usage.list[0].model, "gpt-6-luna");
	assert.equal(body.usage.list[0].price, 0.12);
	assert.equal(body.usage.list[0].createdAt, 1760000000000);
	assert.equal(body.usage.nextId, "1234567890");
	assert.equal(body.usage.pageSize, 2);
	assert.match(calls[0].url, /include_usage=true/);
	assert.match(calls[0].url, /pageSize=2/);
});

await test("the usage page size is clamped to the documented maximum", async () => {
	const module = await freshModule();
	const ctx = makeCtx({ authCode: "sk-test" });
	const calls = stubFetch(() => response(200, USAGE_PAYLOAD));
	module.apply(ctx, { baseURL: "https://gateway.example" });
	const route = ctx.routes.find((entry) => entry.path === module.API.usage);
	await route.handler(makeRequest(`${module.API.usage}?pageSize=9999`), makeResponse());
	assert.match(calls[0].url, /pageSize=100/);
});

await test("launch environment and process env are credential fallbacks", async () => {
	const fromLaunch = await freshModule();
	const launchCtx = makeCtx({ launchEnv: "sk-from-launch" });
	stubFetch((url, init) => response(200, init.headers.authorization === "Bearer sk-from-launch" ? DOCUMENTED_PAYLOAD : { data: { balance: -1, amount: 0 } }));
	fromLaunch.apply(launchCtx, { baseURL: "https://gateway.example" });
	assert.equal((await callBalance(fromLaunch, launchCtx)).json().balance, 85.5);

	const fromEnv = await freshModule();
	process.env.LIAO_API_KEY = "sk-from-env";
	try {
		const envCtx = makeCtx({});
		stubFetch((url, init) => response(200, init.headers.authorization === "Bearer sk-from-env" ? DOCUMENTED_PAYLOAD : { data: { balance: -1, amount: 0 } }));
		fromEnv.apply(envCtx, { baseURL: "https://gateway.example" });
		assert.equal((await callBalance(fromEnv, envCtx)).json().balance, 85.5);
	} finally {
		delete process.env.LIAO_API_KEY;
	}
});

await test("a custom credential ref and top-up URL are honoured", async () => {
	const module = await freshModule();
	const ctx = makeCtx({});
	process.env.MY_LIAO_CODE = "sk-custom";
	try {
		stubFetch(() => response(200, DOCUMENTED_PAYLOAD));
		module.apply(ctx, { baseURL: "https://gateway.example", apiKeyEnv: "MY_LIAO_CODE", topUpURL: "https://example.org/topup" });
		const res = await callBalance(module, ctx);
		assert.equal(res.json().topUpURL, "https://example.org/topup");
	} finally {
		delete process.env.MY_LIAO_CODE;
	}
});

await test("Config ~standard validator applies defaults and coerces host lists", async () => {
	const module = await freshModule();
	const result = module.Config["~standard"].validate({
		baseURL: "https://custom.example",
		fallbackBaseURLs: ["https://b.example", "", "  https://c.example  "],
		usagePageSize: -5,
		refreshIntervalMs: "soon",
		lowThreshold: 0
	});
	const value = result.value;
	assert.equal(value.baseURL, "https://custom.example");
	assert.deepEqual(value.fallbackBaseURLs, ["https://b.example", "https://c.example"]);
	assert.equal(value.usagePageSize, module.Config.defaults.usagePageSize);
	assert.equal(value.refreshIntervalMs, module.Config.defaults.refreshIntervalMs);
	assert.equal(value.lowThreshold, 0);
	assert.equal(value.apiKeyEnv, "LIAO_API_KEY");
	assert.equal(value.stackCards, true);
	// Colour thresholds are absolute credit amounts: yellow below 5, red below 1.
	assert.equal(module.Config.defaults.lowThreshold, 5);
	assert.equal(module.Config.defaults.criticalThreshold, 1);
	assert.equal(module.Config["~standard"].validate({}).value.criticalThreshold, 1);
	assert.equal(module.Config["~standard"].validate({ stackCards: false }).value.stackCards, false);
	assert.equal(module.Config["~standard"].validate({ stackCards: "yes" }).value.stackCards, true);
	assert.equal(module.Config["~standard"].validate("nope").issues.length, 1);
});

await test("the agent tool reports balance and usage through the same client", async () => {
	const module = await freshModule();
	const registered = [];
	const ctx = makeCtx({
		authCode: "sk-test",
		tools: { register: (tool) => { registered.push(tool); return () => {}; } }
	});
	stubFetch((url) => response(200, url.includes("include_usage") ? USAGE_PAYLOAD : DOCUMENTED_PAYLOAD));
	module.apply(ctx, { baseURL: "https://gateway.example" });
	assert.equal(registered.length, 1);
	const tool = registered[0];
	assert.equal(tool.name, "liaobots_balance");
	const both = await tool.execute({ query: "both" });
	assert.match(both.text, /剩余积分 85\.5 \/ 总额度 100/);
	assert.match(both.text, /gpt-6-luna 扣 0\.12 积分/);
});

await test("the tool definition matches the host registry contract", async () => {
	// ToolRuntime.register() rejects a definition without output.render and
	// validates output.schema, so the hand-built tool has to carry both.
	const module = await freshModule();
	const registered = [];
	const ctx = makeCtx({
		authCode: "sk-test",
		tools: {
			register(tool) {
				const output = tool.output;
				if (output === void 0 || typeof output !== "object" || typeof output.render !== "function") {
					throw new TypeError(`tool "${tool.name}" must declare output { schema, render, presentationMeta? }`);
				}
				if (output.schema?.type !== "object") throw new TypeError("output.schema must be an object schema");
				if (tool.name === "run_code") throw new Error("reserved name");
				registered.push(tool);
				return () => {};
			}
		}
	});
	stubFetch(() => response(200, DOCUMENTED_PAYLOAD));
	module.apply(ctx, { baseURL: "https://gateway.example" });
	assert.equal(registered.length, 1, "the tool registered against the contract");
	const tool = registered[0];
	assert.deepEqual(tool.parameters.required, ["query"]);
	assert.equal(tool.parameters.type, "object");
	const value = await tool.execute({ query: "balance" });
	const parts = tool.output.render({ query: "balance" }, value);
	assert.deepEqual(parts, [{ type: "text", text: value.text }], "render returns text content parts");
	assert.equal(typeof value.text, "string");
	assert.match(value.text, /剩余积分 85\.5/);
});

await test("an undeclared tools service is read through ctx.get(), never as a property", async () => {
	const module = await freshModule();
	const registered = [];
	const ctx = guardUndeclaredServices(makeCtx({
		authCode: "sk-test",
		tools: { register: (tool) => { registered.push(tool); return () => {}; } }
	}));
	// Reading ctx.tools here throws exactly like the Cordis proxy does.
	assert.throws(() => ctx.tools, /cannot get property "tools" without inject/);
	const dispose = module.apply(ctx, void 0);
	assert.deepEqual(ctx.routes.map((route) => route.path), [module.API.balance, module.API.usage]);
	assert.equal(registered.length, 1, "the optional service is still reachable through ctx.get()");
	assert.ok(
		ctx.logs.every((line) => !line.includes("tools service") && !line.includes("without inject")),
		`no inject violation was logged: ${ctx.logs.join(" | ")}`
	);
	dispose();
});

await test("teardown disposes the routes", async () => {
	const module = await freshModule();
	let disposed = 0;
	const ctx = makeCtx({ authCode: "sk-test" });
	ctx.webServer.register = () => () => { disposed += 1; };
	ctx.tools = void 0;
	const dispose = module.apply(ctx, void 0);
	dispose();
	assert.equal(disposed, 2);
});

/** ------------------------------------------- re-composition (duplicate mount) */

/** A web server stub that rejects a duplicate (kind, path), like the real one. */
function makeStrictWebServer(ctx, onRegister) {
	const table = new Map();
	ctx.webServer = {
		register(route) {
			if (table.has(route.path)) throw new Error(`webserver: duplicate ${route.kind} route "${route.path}"`);
			table.set(route.path, route);
			onRegister?.(route);
			return () => { table.delete(route.path); };
		}
	};
	return table;
}

await test("a re-composition that applies the plugin twice reuses the live routes", async () => {
	const module = await freshModule();
	const ctx = makeCtx({ authCode: "sk-test" });
	ctx.tools = void 0;
	const table = makeStrictWebServer(ctx);
	const disposeFirst = module.apply(ctx, void 0);
	assert.deepEqual([...table.keys()], [module.API.balance, module.API.usage]);
	// The second mount must not fail the way an unguarded register would.
	const disposeSecond = module.apply(ctx, void 0);
	assert.deepEqual([...table.keys()], [module.API.balance, module.API.usage], "still exactly one route per path");
	// The adopting mount owns nothing: leaving must not remove the live routes.
	disposeSecond();
	assert.deepEqual([...table.keys()], [module.API.balance, module.API.usage], "the live routes survive the adopting mount");
	// The owning mount still unregisters, and a later mount registers afresh.
	disposeFirst();
	assert.equal(table.size, 0, "the owning mount unregisters");
	module.apply(ctx, void 0);
	assert.equal(table.size, 2, "a later mount registers again");
});

await test("a route already registered outside this module instance is adopted, not re-registered", async () => {
	const module = await freshModule();
	const ctx = makeCtx({ authCode: "sk-test" });
	ctx.tools = void 0;
	const table = makeStrictWebServer(ctx);
	// A previous load of this plugin (a distinct module instance in the same
	// process) got there first: the server refuses the duplicate, and this mount
	// has no claim entry to consult.
	table.set(module.API.balance, { kind: "exact", path: module.API.balance, handler: () => {} });
	const dispose = module.apply(ctx, void 0);
	assert.equal(table.size, 2, "the live route is reused and the missing one is registered");
	assert.ok(table.has(module.API.usage), "the other route is registered normally");
	dispose();
	assert.ok(table.has(module.API.balance), "a route this mount does not own is left alone");
	assert.ok(!table.has(module.API.usage), "the route this mount owns is removed");
});

await test("two separate loads of the module share one claim on the live route", async () => {
	// A re-composition can load a fresh copy of the module (HMR), so the claim
	// table has to be process-wide, not per module instance.
	const first = await freshModule();
	const second = await freshModule();
	assert.notEqual(first, second, "the two loads are distinct module instances");
	const ctx = makeCtx({ authCode: "sk-test" });
	ctx.tools = void 0;
	const table = makeStrictWebServer(ctx);
	const disposeFirst = first.apply(ctx, void 0);
	const disposeSecond = second.apply(ctx, void 0);
	assert.equal(table.size, 2, "one route per path after two loads");
	disposeFirst();
	assert.equal(table.size, 2, "the route survives the load that registered it");
	disposeSecond();
	assert.equal(table.size, 0, "the last claim unregisters");
});

await test("a foreign registration failure still throws and unwinds what it registered", async () => {
	const module = await freshModule();
	const ctx = makeCtx({ authCode: "sk-test" });
	ctx.tools = void 0;
	const table = new Map();
	ctx.webServer = {
		register(route) {
			// A duplicate that names somebody else's path is not this plugin's.
			if (route.path === module.API.usage) throw new Error('webserver: duplicate exact route "/api/dsh-liaobots/someone-else"');
			table.set(route.path, route);
			return () => { table.delete(route.path); };
		}
	};
	assert.throws(() => module.apply(ctx, void 0), /someone-else/);
	assert.equal(table.size, 0, "the route registered before the failure is unwound");
});

await test("the agent tool is declared once across mounts and survives the adopting mount", async () => {
	const module = await freshModule();
	const registered = [];
	const names = new Set();
	const tools = {
		register(tool) {
			if (names.has(tool.name)) throw new Error(`Duplicate tool declaration name: ${tool.name}`);
			names.add(tool.name);
			registered.push(tool);
			return () => { names.delete(tool.name); };
		}
	};
	const ctx = makeCtx({ authCode: "sk-test", tools });
	makeStrictWebServer(ctx);
	const disposeFirst = module.apply(ctx, void 0);
	assert.deepEqual([...names], ["liaobots_balance"]);
	const disposeSecond = module.apply(ctx, void 0);
	assert.equal(registered.length, 1, "the tool is not declared twice");
	disposeSecond();
	assert.equal(names.size, 1, "the tool survives the mount that adopted it");
	disposeFirst();
	assert.equal(names.size, 0, "the owning mount removes it");
});

/** ------------------------------------------------------- optional live probe */

if (process.argv.includes("--live")) {
	console.log("\nlive gateway probe (invalid login code, expects an auth classification)");
	globalThis.fetch = realFetch;
	await test("the documented endpoint answers on a reachable host", async () => {
		const module = await freshModule();
		const ctx = makeCtx({ authCode: "sk-invalid-probe" });
		module.apply(ctx, {
			baseURL: "https://ai.liaobots1.work",
			fallbackBaseURLs: ["https://ai.liaobots2.work", "https://ai.liaobots3.work"],
			requestTimeoutMs: 10000
		});
		const res = await callBalance(module, ctx);
		const body = res.json();
		assert.equal(res.statusCode, 502);
		assert.equal(body.code, "auth", `unexpected body: ${res.body}`);
		console.log(`       gateway said: ${body.error}`);
	});
}

console.log(`\n${passed} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
