/**
 * dsh-liaobots-balance — host half.
 *
 * Registers two loopback-only API routes over ctx.webServer:
 *   GET /api/dsh-liaobots/balance  → Liaobots credit balance (documented
 *                                    GET /api/v1/credits on the AI gateway)
 *   GET /api/dsh-liaobots/usage    → recent deduction records
 *                                    (GET /api/v1/credits?include_usage=true)
 *
 * Documentation: https://docs.liaobots.work/Getting-Started/cn/API (section
 * "查询余额"). The endpoint answers
 *   { "data": { "balance": 85.5, "amount": 100.0 } }
 * where `balance` is the remaining credits and `amount` the total quota.
 * `include_usage=true&pageSize=N` adds
 *   data.usage = { pageSize, nextId, list: [{ id, model, price, tokens, … }] }.
 *
 * The login code (authcode) is resolved through the host's credentials
 * service — the same seam @deepseek-ai/dsh-llm uses for provider keys — and
 * never leaves the host process: the browser only talks to these same-origin
 * routes. Routes are guarded loopback-only, mirroring dsh-balance-widget.
 *
 * Registration is claim-based (see `claimRegistration`): DSH re-composes a
 * profile after a plugin-manager change, and that re-composition can apply this
 * row again while the previous mount is still live. The host refuses a second
 * registration of the same route, so the later mount adopts the live one and
 * the last mount to leave unregisters it.
 *
 * Several gateway hosts serve the same API (the documented primary
 * `ai.liaobots.work` plus the `ai.liaobots1..3.work` mirrors). Networks that
 * cannot reach the primary get automatic failover: the host that answered last
 * is tried first, the rest in order.
 *
 * This module deliberately imports NO @deepseek-ai/* packages so it resolves
 * from any profile layout (npm, workspace link, or flat fallback).
 */

/** Stable cordis plugin name. */
export const name = "liaobots-balance";

/** Services required before the credits surface can mount. */
export const inject = ["webServer"];

/** Route paths shared with the browser half (spelled here, not imported). */
export const API = {
	balance: "/api/dsh-liaobots/balance",
	usage: "/api/dsh-liaobots/usage"
};

/** Agent tool name; also the identity of its registration on the tools service. */
const TOOL_NAME = "liaobots_balance";

/** Documented credits endpoint path on every gateway host. */
const CREDITS_PATH = "/api/v1/credits";
/** Default gateway host (mirror 1: the primary is unreachable on some networks). */
const DEFAULT_BASE_URL = "https://ai.liaobots1.work";
/** Remaining documented hosts, tried in order when `baseURL` does not answer. */
const DEFAULT_FALLBACK_BASE_URLS = [
	"https://ai.liaobots.work",
	"https://ai.liaobots2.work",
	"https://ai.liaobots3.work"
];
/** Default credential ref: the key the `liao` provider is configured with. */
const DEFAULT_API_KEY_ENV = "LIAO_API_KEY";
/** Default top-up / console page opened from the card. */
const DEFAULT_TOP_UP_URL = "https://liaobots.work";
/** Balance answers are cached this long to keep auto-refresh cheap. */
const BALANCE_CACHE_TTL_MS = 15000;
/** Recent-usage answers are cached this long. */
const USAGE_CACHE_TTL_MS = 30000;
/** Largest page accepted from the browser half. */
const MAX_USAGE_PAGE_SIZE = 100;

/**
 * Config schema exposed to the cordis loader. Cordis calls
 * `Config["~standard"].validate(config)` and expects a Standard Schema
 * (version 1) result — the same interface @deepseek-ai/schemastery produces.
 * Hand-built here so the host half keeps ZERO external imports.
 */
const CONFIG_FIELDS = {
	baseURL: "string",
	fallbackBaseURLs: "string[]",
	apiKeyEnv: "string",
	requestTimeoutMs: "number",
	usagePageSize: "number",
	refreshIntervalMs: "number",
	lowThreshold: "number",
	criticalThreshold: "number",
	topUpURL: "string",
	stackCards: "boolean"
};
const CONFIG_DEFAULTS = {
	baseURL: DEFAULT_BASE_URL,
	fallbackBaseURLs: DEFAULT_FALLBACK_BASE_URLS,
	apiKeyEnv: DEFAULT_API_KEY_ENV,
	requestTimeoutMs: 8000,
	usagePageSize: 10,
	refreshIntervalMs: 60000,
	lowThreshold: 10,
	criticalThreshold: 3,
	topUpURL: DEFAULT_TOP_UP_URL,
	stackCards: true
};

/** Coerce a config value into a list of non-empty host strings. */
function toHostList(raw, fallback) {
	const values = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : null;
	if (values === null) return fallback;
	const hosts = values
		.filter((entry) => typeof entry === "string")
		.map((entry) => entry.trim())
		.filter((entry) => entry !== "");
	return hosts.length > 0 ? hosts : fallback;
}

export const Config = {
	"~standard": {
		version: 1,
		vendor: "dsh-liaobots-balance",
		validate(value) {
			if (value === void 0 || value === null) value = {};
			if (typeof value !== "object") {
				return { issues: [{ message: "config must be an object", path: [] }] };
			}
			const out = {};
			for (const [key, type] of Object.entries(CONFIG_FIELDS)) {
				const raw = value[key];
				const fallback = CONFIG_DEFAULTS[key];
				if (raw === void 0 || raw === null) {
					out[key] = fallback;
					continue;
				}
				if (type === "string" && typeof raw === "string" && raw !== "") {
					out[key] = raw;
				} else if (type === "string[]" && (Array.isArray(raw) || typeof raw === "string")) {
					out[key] = toHostList(raw, fallback);
				} else if (type === "number" && typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
					out[key] = raw;
				} else if (type === "boolean" && typeof raw === "boolean") {
					out[key] = raw;
				} else {
					out[key] = fallback;
				}
			}
			return { value: out };
		}
	},
	shape: CONFIG_FIELDS,
	defaults: CONFIG_DEFAULTS
};

/** Resolve config with defaults applied. */
function resolveConfig(raw) {
	const value = raw ?? {};
	const number = (key, min) => {
		const candidate = value[key];
		return typeof candidate === "number" && Number.isFinite(candidate) && candidate >= min
			? candidate
			: Config.defaults[key];
	};
	return {
		baseURL: typeof value.baseURL === "string" && value.baseURL !== "" ? value.baseURL : Config.defaults.baseURL,
		fallbackBaseURLs: toHostList(value.fallbackBaseURLs, Config.defaults.fallbackBaseURLs),
		apiKeyEnv: typeof value.apiKeyEnv === "string" && value.apiKeyEnv !== ""
			? value.apiKeyEnv
			: Config.defaults.apiKeyEnv,
		requestTimeoutMs: number("requestTimeoutMs", 1),
		usagePageSize: Math.min(MAX_USAGE_PAGE_SIZE, Math.round(number("usagePageSize", 1))),
		refreshIntervalMs: Math.max(5000, Math.round(number("refreshIntervalMs", 5000))),
		lowThreshold: number("lowThreshold", 0),
		criticalThreshold: number("criticalThreshold", 0),
		topUpURL: typeof value.topUpURL === "string" && value.topUpURL !== "" ? value.topUpURL : Config.defaults.topUpURL,
		stackCards: typeof value.stackCards === "boolean" ? value.stackCards : Config.defaults.stackCards
	};
}

/** Write a JSON response with a status code. */
function writeJson(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": Buffer.byteLength(payload),
		"cache-control": "no-store"
	});
	res.end(payload);
}

/** Whether the request comes from the loopback interface. */
function isLoopbackRequest(req) {
	const address = req.socket?.remoteAddress ?? "";
	return address === "::1"
		|| address === "::ffff:127.0.0.1"
		|| address === "127.0.0.1"
		|| address === "localhost"
		|| address.startsWith("::ffff:127.");
}

/** Guard helper: loopback fence + method check. */
function guard(req, res, method) {
	if (!isLoopbackRequest(req)) {
		writeJson(res, 403, { ok: false, error: "forbidden: loopback-only" });
		return false;
	}
	if ((req.method ?? "GET") !== method) {
		writeJson(res, 405, { ok: false, error: `method not allowed: ${req.method}` });
		return false;
	}
	return true;
}

/** Strip trailing slashes from a base URL. */
function trimBase(baseURL) {
	return String(baseURL).replace(/\/+$/, "");
}

/**
 * Resolve the Liaobots login code through the host credentials service.
 * Falls back to the launch environment, then process env. Returns undefined
 * when absent everywhere.
 */
async function resolveAuthCode(ctx, config) {
	try {
		const credentials = ctx.get("credentials");
		if (credentials !== void 0) {
			const hit = await credentials.resolve(config.apiKeyEnv);
			if (hit !== void 0 && hit.value !== void 0 && hit.value !== "") return hit.value;
		}
	} catch (error) {
		ctx.logger?.warn?.(
			"[dsh-liaobots-balance] credentials resolve failed: %s",
			error instanceof Error ? error.message : String(error)
		);
	}
	try {
		const environment = ctx.get("launchEnvironment");
		if (environment !== void 0) {
			const entry = environment.get(config.apiKeyEnv);
			if (entry !== void 0 && entry.value.length > 0) return entry.value;
		}
	} catch {
		/* fall through to process env */
	}
	const ambient = process.env[config.apiKeyEnv];
	if (ambient !== void 0 && ambient !== "") return ambient;
	return void 0;
}

/** Describe the login-code failure the same way on every transport. */
function authError(message) {
	return { ok: false, code: "auth", error: message };
}

/**
 * Turn a gateway answer into the payload the browser half renders.
 * @returns {{balance: number, amount: number|null, usage: object|undefined}|null}
 */
function parseCredits(body) {
	if (body === null || typeof body !== "object") return null;
	const data = body.data !== null && typeof body.data === "object" ? body.data : body;
	const balance = Number(data.balance);
	if (!Number.isFinite(balance)) return null;
	const amount = Number(data.amount);
	return {
		balance,
		amount: Number.isFinite(amount) ? amount : null,
		usage: data.usage !== null && typeof data.usage === "object" ? data.usage : void 0
	};
}

/**
 * Normalize the documented usage block into plain rows.
 * @returns {{list: Array<object>, nextId: string|null, pageSize: number|null}}
 */
function parseUsage(usage) {
	const raw = Array.isArray(usage?.list) ? usage.list : [];
	const list = raw.map((entry) => ({
		id: entry?.id ?? null,
		model: typeof entry?.model === "string" ? entry.model : "",
		price: Number.isFinite(Number(entry?.price)) ? Number(entry.price) : null,
		tokens: Number.isFinite(Number(entry?.tokens)) ? Number(entry.tokens) : null,
		inputTokens: Number.isFinite(Number(entry?.input_tokens)) ? Number(entry.input_tokens) : null,
		outputTokens: Number.isFinite(Number(entry?.output_tokens)) ? Number(entry.output_tokens) : null,
		cacheHitTokens: Number.isFinite(Number(entry?.cache_hit_tokens)) ? Number(entry.cache_hit_tokens) : null,
		createdAt: Number.isFinite(Number(entry?.create_time)) ? Number(entry.create_time) : null
	}));
	return {
		list,
		nextId: typeof usage?.nextId === "string" && usage.nextId !== "" ? usage.nextId : null,
		pageSize: Number.isFinite(Number(usage?.pageSize)) ? Number(usage.pageSize) : null
	};
}

/** Host that answered most recently, tried first on the next request. */
let preferredHost = void 0;

/**
 * Candidate gateway hosts, most promising first: the host that answered the
 * previous request, then the configured base URL, then the documented mirrors.
 */
function candidateHosts(config) {
	const hosts = [];
	const push = (host) => {
		if (typeof host !== "string") return;
		const trimmed = trimBase(host);
		if (trimmed !== "" && !hosts.includes(trimmed)) hosts.push(trimmed);
	};
	push(preferredHost);
	push(config.baseURL);
	for (const host of config.fallbackBaseURLs) push(host);
	return hosts;
}

/**
 * One credits request against one host.
 * @returns {{status: number, ok: boolean, body: object|undefined, text: string}}
 */
async function requestCredits(host, authCode, config, query) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
	try {
		const response = await fetch(`${host}${CREDITS_PATH}${query}`, {
			method: "GET",
			headers: {
				authorization: `Bearer ${authCode}`,
				accept: "application/json"
			},
			signal: controller.signal
		});
		const text = await response.text();
		let body;
		try {
			body = JSON.parse(text);
		} catch {
			body = void 0;
		}
		return { status: response.status, ok: response.ok, body, text };
	} finally {
		clearTimeout(timer);
	}
}

/** Message for a transport-level failure. */
function transportMessage(host, error) {
	const code = error?.cause?.code ?? error?.code ?? "";
	if (error?.name === "AbortError" || code === "UND_ERR_HEADERS_TIMEOUT" || code === "UND_ERR_CONNECT_TIMEOUT") {
		return `${host} 连接超时`;
	}
	if (code === "ENOTFOUND" || code === "EAI_AGAIN") return `${host} 域名解析失败`;
	if (code === "ECONNREFUSED") return `${host} 拒绝连接`;
	return `${host} 请求失败（${code !== "" ? code : (error instanceof Error ? error.message : String(error))}）`;
}

/**
 * Query the gateway: resolve the login code, walk the candidate hosts, and
 * return either the credits payload or a classified failure.
 * @param {object} ctx - host plugin context.
 * @param {object} config - resolved config.
 * @param {{includeUsage?: boolean, pageSize?: number, nextId?: string}} [options]
 */
async function queryCredits(ctx, config, options = {}) {
	const authCode = await resolveAuthCode(ctx, config);
	if (authCode === void 0) {
		return {
			ok: false,
			code: "no-credentials",
			error: `未找到登录码 ${config.apiKeyEnv}：请在 DSH 设置中为 Liaobots 提供方填入 Key，或设置同名环境变量后重启。`
		};
	}
	const params = [];
	if (options.includeUsage === true) {
		params.push("include_usage=true");
		params.push(`pageSize=${Math.min(MAX_USAGE_PAGE_SIZE, Math.max(1, Math.round(options.pageSize ?? config.usagePageSize)))}`);
		if (typeof options.nextId === "string" && options.nextId !== "") {
			params.push(`nextId=${encodeURIComponent(options.nextId)}`);
		}
	}
	const query = params.length > 0 ? `?${params.join("&")}` : "";
	const hosts = candidateHosts(config);
	const failures = [];
	for (const host of hosts) {
		let answer;
		try {
			answer = await requestCredits(host, authCode, config, query);
		} catch (error) {
			failures.push(transportMessage(host, error));
			continue;
		}
		if (answer.ok) {
			const parsed = parseCredits(answer.body);
			if (parsed === null) {
				failures.push(`${host} 返回了无法解析的响应`);
				continue;
			}
			preferredHost = host;
			return {
				ok: true,
				balance: parsed.balance,
				amount: parsed.amount,
				usage: options.includeUsage === true ? parseUsage(parsed.usage) : void 0,
				host,
				fetchedAt: Date.now()
			};
		}
		// Bad login code: identical on every host, so stop instead of retrying.
		if (answer.status === 401 || answer.status === 403) {
			return authError(`登录码无效或无权访问（HTTP ${answer.status}）`);
		}
		const bodyError = typeof answer.body?.error === "string" ? answer.body.error : "";
		// The gateway answers `404 {"error":"user not found"}` for an unknown
		// login code — that is the documented shape, not a routing miss.
		if (answer.status === 404 && /user not found|unauthor|invalid/i.test(bodyError)) {
			return authError(`登录码无效：${bodyError}（请检查 ${config.apiKeyEnv}）`);
		}
		if (answer.status === 402) {
			return { ok: false, code: "payment", error: "账户额度不足或已停用（HTTP 402）" };
		}
		if (answer.status === 429) {
			failures.push(`${host} 请求过于频繁（HTTP 429）`);
			continue;
		}
		const detail = bodyError !== "" ? bodyError : answer.text.slice(0, 120).replace(/\s+/g, " ");
		failures.push(`${host} HTTP ${answer.status}${detail !== "" ? `：${detail}` : ""}`);
	}
	return {
		ok: false,
		code: "unreachable",
		error: `无法连接 Liaobots 网关：${failures.join("；")}`
	};
}

/** Attach display thresholds and derived figures to a successful payload. */
function decorate(config, payload) {
	const amount = payload.amount;
	const used = typeof amount === "number" ? Math.max(0, amount - payload.balance) : null;
	const remainingRatio = typeof amount === "number" && amount > 0 ? payload.balance / amount : null;
	return {
		...payload,
		used,
		remainingRatio,
		lowThreshold: config.lowThreshold,
		criticalThreshold: config.criticalThreshold,
		refreshIntervalMs: config.refreshIntervalMs,
		topUpURL: config.topUpURL,
		stackCards: config.stackCards
	};
}

/** Cached answers keyed by request shape. */
const cache = new Map();

/**
 * Serve through a short-lived cache so the card's auto-refresh and the
 * popover's first paint share one upstream request.
 */
async function cached(key, ttl, compute) {
	const hit = cache.get(key);
	const now = Date.now();
	if (hit !== void 0 && now - hit.at < ttl) return { ...hit.value, cached: true };
	const value = await compute();
	if (value.ok === true) cache.set(key, { at: now, value });
	return { ...value, cached: false };
}

/** Build the route table. */
function makeRoutes(ctx, config) {
	return [
		{
			kind: "exact",
			path: API.balance,
			handler: async (req, res) => {
				if (!guard(req, res, "GET")) return;
				const result = await cached("balance", BALANCE_CACHE_TTL_MS, () => queryCredits(ctx, config));
				if (!result.ok) {
					writeJson(res, result.code === "no-credentials" ? 400 : 502, result);
					return;
				}
				writeJson(res, 200, decorate(config, result));
			}
		},
		{
			kind: "exact",
			path: API.usage,
			handler: async (req, res) => {
				if (!guard(req, res, "GET")) return;
				const url = new URL(req.url ?? "/", "http://localhost");
				const rawPageSize = Number(url.searchParams.get("pageSize"));
				const pageSize = Number.isFinite(rawPageSize) && rawPageSize > 0
					? Math.min(MAX_USAGE_PAGE_SIZE, Math.round(rawPageSize))
					: config.usagePageSize;
				const nextId = url.searchParams.get("nextId") ?? "";
				const key = `usage:${pageSize}:${nextId}`;
				const result = await cached(key, USAGE_CACHE_TTL_MS, () => queryCredits(ctx, config, {
					includeUsage: true,
					pageSize,
					nextId
				}));
				if (!result.ok) {
					writeJson(res, result.code === "no-credentials" ? 400 : 502, result);
					return;
				}
				writeJson(res, 200, decorate(config, result));
			}
		}
	];
}

/**
 * Build the `liaobots_balance` agent tool: lets the model answer "我的
 * Liaobots 余额还剩多少" without going through the UI.
 *
 * Hand-constructed registry definition (no `defineTool` import) to keep zero
 * external dependencies. The host tool registry requires `output.render`, so a
 * plain `{ name, description, parameters, execute }` object is rejected with
 * `must declare output { schema, render }`; `parameters` and `output.schema`
 * are raw JSON Schema (what defineTool also produces), and `execute` returns a
 * value matching `output.schema`.
 */
function buildCreditsTool(ctx, config) {
	return {
		name: TOOL_NAME,
		description: "Query the Liaobots account credit balance and recent deductions (Liaobots gateway GET /api/v1/credits). Use when the user asks about their Liaobots credits, quota or spending. query = 'balance' (remaining credits + total quota), 'usage' (recent deductions), or 'both'.",
		parameters: {
			type: "object",
			additionalProperties: false,
			properties: {
				query: {
					type: "string",
					enum: ["balance", "usage", "both"],
					description: "What to query: balance, usage, or both."
				}
			},
			required: ["query"]
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: { text: { type: "string" } },
				required: ["text"]
			},
			render: (_args, value) => [{ type: "text", text: value.text }]
		},
		async execute(args) {
			const query = args?.query ?? "balance";
			const parts = [];
			if (query === "balance" || query === "both") {
				const result = await queryCredits(ctx, config);
				if (result.ok) {
					parts.push(`剩余积分 ${result.balance}${result.amount !== null ? ` / 总额度 ${result.amount}` : ""}（网关 ${result.host}）`);
				} else {
					parts.push(`余额查询失败：${result.error}`);
				}
			}
			if (query === "usage" || query === "both") {
				const result = await queryCredits(ctx, config, { includeUsage: true, pageSize: config.usagePageSize });
				if (result.ok && result.usage !== void 0) {
					const rows = result.usage.list.map((entry) => {
						const when = entry.createdAt !== null ? new Date(entry.createdAt).toISOString() : "?";
						return `${when} ${entry.model || "unknown"} 扣 ${entry.price ?? "?"} 积分（${entry.tokens ?? "?"} tokens）`;
					});
					parts.push(rows.length > 0 ? `最近扣费：\n${rows.join("\n")}` : "最近没有扣费记录。");
				} else if (!result.ok) {
					parts.push(`用量查询失败：${result.error}`);
				}
			}
			return { text: parts.join("\n") };
		}
	};
}

/**
 * Whether a route-registration failure is one of this plugin's own exact routes
 * already being registered by an earlier mount in the same process.
 *
 * DSH re-composes a profile when the plugin manager changes it, and a
 * re-composition can apply this row again while the previous mount is still
 * live. The host web server treats a duplicate `(kind, path)` as a composition
 * error and throws, which would fail an entry whose routes are in fact serving.
 * Only a duplicate naming this plugin's own namespaced path qualifies; every
 * other failure still propagates.
 */
function isOwnDuplicateRoute(error, route) {
	const message = error instanceof Error ? error.message : String(error);
	return message.includes("duplicate") && message.includes(`"${route.path}"`);
}

/**
 * Process-wide registration tables, keyed by service instance.
 *
 * Kept on `globalThis` under a `Symbol.for` key because a re-composition can
 * load a fresh copy of this module (HMR module invalidation): every load has to
 * see - and ref-count - the same live registrations, not a private view of them.
 */
const REGISTRY = Symbol.for("dsh-liaobots-balance.registration-tables");

/** The shared service-to-identity-table map, created on first use. */
function registrationTables() {
	const existing = globalThis[REGISTRY];
	if (existing instanceof WeakMap) return existing;
	const tables = new WeakMap();
	globalThis[REGISTRY] = tables;
	return tables;
}

/** The identity table of one service instance, created on first use. */
function registrationTable(service) {
	if (service === null || typeof service !== "object") return void 0;
	const tables = registrationTables();
	let table = tables.get(service);
	if (table === void 0) {
		table = new Map();
		tables.set(service, table);
	}
	return table;
}

/** Drop one claim; the last claim unregisters the registration. */
function releaseRegistration(table, key, entry) {
	entry.claims -= 1;
	if (entry.claims > 0) return;
	table.delete(key);
	if (typeof entry.dispose === "function") entry.dispose();
}

/**
 * Claim one registration identity on a host service: a route on the web
 * server, or the agent tool on the tools service.
 *
 * Claims are counted per mount. The first claim registers; a later claim
 * adopts the live registration, because the handler behind it is this plugin's
 * either way; the last claim to leave unregisters. An earlier mount leaving
 * first can therefore never take the registration away from the mount that
 * adopted it - the failure mode a plain "skip the duplicate" would introduce.
 *
 * @param service - the service owning the registrations.
 * @param key - registration identity (a route path, or a tool name).
 * @param register - creates the registration and returns its disposer.
 * @param tolerate - whether a failure means "already registered elsewhere".
 * @returns the release function, and whether this claim adopted a live one.
 */
function claimRegistration(service, key, register, tolerate) {
	const table = registrationTable(service);
	const live = table?.get(key);
	if (live !== void 0) {
		live.claims += 1;
		return { release: () => releaseRegistration(table, key, live), adopted: true };
	}
	let entry;
	let adopted = false;
	try {
		const dispose = register();
		entry = { claims: 1, dispose: typeof dispose === "function" ? dispose : void 0 };
	} catch (error) {
		if (!tolerate(error)) throw error;
		// Another load of this module owns it: keep it, and leave its removal
		// to whoever does.
		entry = { claims: 1, dispose: void 0 };
		adopted = true;
	}
	if (table !== void 0) table.set(key, entry);
	return {
		release: () => {
			if (table !== void 0) releaseRegistration(table, key, entry);
		},
		adopted
	};
}

/** Claim one of this plugin's routes; adoption is expected, so it is logged. */
function claimRoute(ctx, route) {
	return claimRegistration(ctx.webServer, route.path, () => ctx.webServer.register(route), (error) => {
		const own = isOwnDuplicateRoute(error, route);
		if (own) {
			ctx.logger?.info?.(
				"[dsh-liaobots-balance] route %s is already registered by an earlier mount; reusing the live one",
				route.path
			);
		}
		return own;
	});
}

/**
 * Claim the agent tool; any failure stays non-fatal.
 *
 * The tools service is read through `ctx.get("tools")`, never `ctx.tools`:
 * Cordis gates property access on services this plugin declared in `inject`,
 * and reading an undeclared one throws `cannot get property "tools" without
 * inject`. The tool is optional, so the service must stay optional too - and
 * `ctx.get()` is the accessor that does not throw when it is absent.
 */
function claimTool(ctx, config) {
	let service;
	try {
		service = ctx.get("tools");
	} catch (error) {
		ctx.logger?.warn?.(
			"[dsh-liaobots-balance] cannot read the tools service: %s",
			error instanceof Error ? error.message : String(error)
		);
		return void 0;
	}
	if (service === void 0 || typeof service.register !== "function") return void 0;
	try {
		return claimRegistration(service, TOOL_NAME, () => service.register(buildCreditsTool(ctx, config)), (error) => {
			const message = error instanceof Error ? error.message : String(error);
			return /duplicate/i.test(message) && message.includes(TOOL_NAME);
		});
	} catch (error) {
		ctx.logger?.warn?.(
			"[dsh-liaobots-balance] tool registration failed: %s",
			error instanceof Error ? error.message : String(error)
		);
		return void 0;
	}
}

/**
 * Cordis plugin apply: register the routes (and the agent tool) on the host.
 *
 * Registration is claim-based (see `claimRegistration`): a re-composition can
 * apply this row again while the previous mount is still live, and that must
 * neither fail the entry nor tear down the routes that are already serving.
 */
export function apply(ctx, config) {
	const resolved = resolveConfig(config);
	const routes = makeRoutes(ctx, resolved);
	const claims = [];
	try {
		for (const route of routes) claims.push(claimRoute(ctx, route));
		claims.push(claimTool(ctx, resolved));
	} catch (error) {
		// A failed apply never returns its disposer, so unwind everything this
		// mount claimed; a leftover route would collide with the next mount.
		for (const claim of claims.reverse()) claim?.release();
		throw error;
	}
	ctx.logger?.info?.("[dsh-liaobots-balance] routes %s registered (base %s)", Object.values(API).join(", "), resolved.baseURL);
	let released = false;
	return () => {
		if (released) return;
		released = true;
		for (const claim of claims.reverse()) claim?.release();
		cache.clear();
		preferredHost = void 0;
	};
}
