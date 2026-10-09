/**
 * Packaging-metadata tests for dsh-liaobots-balance.
 *
 * These replicate what the DSH host does when it lists a profile bundle, so a
 * packaging regression (a missing locale export, a broken `dsh.bundle.patch`
 * path, an incompatible DSH peer range) fails here instead of showing up as a
 * plugin that "is installed but missing from the plugin list".
 *
 * Mirrors @deepseek-ai/dsh-app-boot: `readPluginMeta()` resolves
 * `<pkg>/locale/en.json` through the package's own `exports`, lists the files
 * beside it, and requires `meta.title` / `meta.description` strings;
 * `bundleManifest()` requires `dsh.bundle.patch`; `evaluatePluginCompatibility()`
 * checks the `@deepseek-ai/dsh` peer range against the running runtime version.
 *
 * Usage:  node test/package.test.mjs [runtimeVersion]
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import semver from "semver";

let failures = 0;
let passed = 0;
function test(title, body) {
	try {
		body();
		passed += 1;
		console.log(`  ok   ${title}`);
	} catch (error) {
		failures += 1;
		console.log(`  FAIL ${title}\n       ${error instanceof Error ? error.message : String(error)}`);
	}
}

/** The display metadata reader's language-id rule, copied from app-boot. */
const LANGUAGE_ID = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u;
/** DSH runtime version the desktop app currently runs. */
const RUNTIME_VERSION = process.argv[2] ?? "0.2.0-rc.2";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const manifestPath = join(packageRoot, "package.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
// A package resolves itself by name only when it declares `exports`; this is the
// same resolution base the host uses for the profile.
const resolver = createRequire(pathToFileURL(manifestPath));

console.log(`dsh-liaobots-balance packaging (runtime ${RUNTIME_VERSION})`);

test("the host can resolve the host half, the client half and the bundle patch", () => {
	const entry = resolver.resolve(manifest.name);
	assert.equal(entry, join(packageRoot, "lib", "index.js"));
	const client = resolver.resolve(`${manifest.name}/client`);
	assert.equal(client, join(packageRoot, "lib", "client.js"));
	const patchPath = join(packageRoot, manifest.dsh.bundle.patch);
	assert.ok(existsSync(patchPath), `bundle patch missing: ${patchPath}`);
	const patch = readFileSync(patchPath, "utf8");
	assert.match(patch, /id:\s*liaobots-balance/);
	assert.match(patch, /name:\s*'dsh-liaobots-balance'/);
});

test("the client half is declared for the web platform", () => {
	assert.equal(manifest.dsh.client.platform, "web");
	assert.ok(Array.isArray(manifest.dsh.client.inject));
});

test("the locale export exists so display metadata resolves", () => {
	assert.ok(
		Object.hasOwn(manifest.exports, "./locale/*.json"),
		"exports must expose ./locale/*.json or the host sees no display metadata"
	);
	assert.ok(manifest.files.includes("locale/*.json"), "locale files must ship");
	const englishPath = resolver.resolve(`${manifest.name}/locale/en.json`);
	assert.ok(existsSync(englishPath), `en.json missing: ${englishPath}`);
});

test("every locale file is a valid language dictionary with a title", () => {
	const englishPath = resolver.resolve(`${manifest.name}/locale/en.json`);
	const localeDir = dirname(englishPath);
	const files = readdirSync(localeDir).filter((name) => name.endsWith(".json"));
	assert.ok(files.includes("en.json"), "en.json is the anchor the host lists from");
	assert.ok(files.includes("zh.json"), "a Chinese title is expected");
	const seen = new Set();
	for (const file of files) {
		const language = file.slice(0, -".json".length);
		assert.ok(LANGUAGE_ID.test(language), `${file}: filename must be a language id`);
		assert.ok(!seen.has(language.toLowerCase()), `${file}: duplicate locale`);
		seen.add(language.toLowerCase());
		// Resolve each file the way the host does, through the package specifier.
		const resolved = resolver.resolve(`${manifest.name}/locale/${file}`);
		assert.equal(dirname(resolved), localeDir, `${file} must sit beside en.json`);
		const parsed = JSON.parse(readFileSync(resolved, "utf8"));
		assert.equal(typeof parsed.meta, "object", `${file}: meta object required`);
		assert.ok(typeof parsed.meta.title === "string" && parsed.meta.title.trim() !== "", `${file}: meta.title required`);
		assert.ok(
			typeof parsed.meta.description === "string" && parsed.meta.description.trim() !== "",
			`${file}: meta.description required`
		);
	}
});

test("the localised titles differ per language", () => {
	const read = (file) => JSON.parse(readFileSync(join(packageRoot, "locale", file), "utf8")).meta.title;
	assert.equal(read("en.json"), "Liaobots Balance");
	assert.equal(read("zh.json"), "Liaobots 余额");
});

test("the DSH peer range accepts the running runtime (else the bundle is denied)", () => {
	const range = manifest.peerDependencies["@deepseek-ai/dsh"];
	assert.ok(semver.satisfies(RUNTIME_VERSION, range, { includePrerelease: true }), `${RUNTIME_VERSION} does not satisfy ${range}`);
});

test("react stays a peer dependency, never a runtime dependency", () => {
	assert.equal(manifest.dependencies, void 0, "the plugin must stay dependency-free");
	assert.ok(manifest.peerDependencies.react !== void 0);
});

console.log(`\n${passed} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
