/**
 * Register dsh-liaobots-balance in a DSH profile roster.
 *
 * A profile composes its plugin tree from the bundles listed in
 * `<DSH_HOME>/profiles/<profile>/package.json` → `dsh.profile.bundles`. The
 * package itself may already be installed in the profile's node_modules (pnpm
 * `add`, done by the GUI plugin manager or by
 * `dsh plugin --profile <name> add <spec>`); this script only makes sure the
 * bundle is listed, so the profile actually loads it.
 *
 * Usage:
 *   node scripts/enable-in-profile.mjs [profile]            # add the bundle
 *   node scripts/enable-in-profile.mjs [profile] --remove   # take it back out
 *   node scripts/enable-in-profile.mjs [profile] --dry-run  # print, change nothing
 *
 * The profile file is copied to `package.json.bak-<timestamp>` before writing.
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const PACKAGE = "dsh-liaobots-balance";
const flags = process.argv.slice(2).filter((arg) => arg.startsWith("--"));
const positional = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const profile = positional[0] ?? "desktop";
const dryRun = flags.includes("--dry-run");
const remove = flags.includes("--remove");

const dshHome = process.env.DSH_HOME ?? join(homedir(), ".dsh");
const profileFile = resolve(join(dshHome, "profiles", profile, "package.json"));

if (!existsSync(profileFile)) {
	console.error(`profile package.json not found: ${profileFile}`);
	process.exit(1);
}

const original = readFileSync(profileFile, "utf8");
const manifest = JSON.parse(original);
manifest.dsh ??= {};
manifest.dsh.profile ??= {};
manifest.dsh.profile.bundles ??= [];
const bundles = manifest.dsh.profile.bundles;
const index = bundles.indexOf(PACKAGE);
const present = index !== -1;

if (remove) {
	if (!present) {
		console.log(`already absent from dsh.profile.bundles: ${PACKAGE}`);
		process.exit(0);
	}
	bundles.splice(index, 1);
} else if (present) {
	console.log(`already listed in dsh.profile.bundles: ${PACKAGE}`);
	process.exit(0);
} else {
	bundles.push(PACKAGE);
}

const next = `${JSON.stringify(manifest, null, 2)}\n`;
if (dryRun) {
	console.log(`would write ${profileFile}:\n${next}`);
	process.exit(0);
}
copyFileSync(profileFile, `${profileFile}.bak-${Date.now()}`);
writeFileSync(profileFile, next, "utf8");
console.log(`${remove ? "removed from" : "added to"} dsh.profile.bundles: ${PACKAGE}`);
console.log(`profile: ${profileFile}`);
console.log("restart the DSH app (or re-run dsh --profile " + profile + ") to load the plugin.");
