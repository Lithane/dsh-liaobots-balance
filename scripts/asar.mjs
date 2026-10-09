/**
 * Minimal Electron ASAR reader: parse the header index, list entries and
 * extract single files, so the DSH plugin-manager code can be inspected
 * without unpacking the whole 120 MB archive.
 *
 * Usage:
 *   node scripts/asar.mjs list <archive> [regex]
 *   node scripts/asar.mjs cat  <archive> <inner/path>
 */
import { openSync, readSync, closeSync, writeFileSync } from "node:fs";

/** Parse the header and return { index, dataStart }. */
function readIndex(archive) {
	const fd = openSync(archive, "r");
	try {
		const first = Buffer.alloc(16);
		readSync(fd, first, 0, 16, 0);
		// Layout: [u32 4][u32 headerPickleSize][u32 headerPickleSize-4][u32 jsonLength][json…]
		const pickleSize = first.readUInt32LE(4);
		const jsonLength = first.readUInt32LE(12);
		const json = Buffer.alloc(jsonLength);
		readSync(fd, json, 0, jsonLength, 16);
		const index = JSON.parse(json.toString("utf8"));
		// File data begins right after the 8-byte size prefix and the pickle.
		const dataStart = 8 + pickleSize;
		return { fd, index, dataStart, jsonLength, pickleSize };
	} catch (error) {
		closeSync(fd);
		throw error;
	}
}

/** Flatten the index into [{ path, size, offset }]. */
function flatten(node, prefix = "") {
	const out = [];
	for (const [name, entry] of Object.entries(node.files ?? {})) {
		const path = prefix === "" ? name : `${prefix}/${name}`;
		if (entry.files !== void 0) out.push(...flatten(entry, path));
		else out.push({ path, size: Number(entry.size ?? 0), offset: entry.offset === void 0 ? null : Number(entry.offset) });
	}
	return out;
}

const [command, archive, ...rest] = process.argv.slice(2);
if (archive === void 0) {
	console.error("usage: node scripts/asar.mjs list|cat <archive> [arg]");
	process.exit(2);
}
const { fd, index, dataStart } = readIndex(archive);
const files = flatten(index);
console.log(`# ${files.length} entries, dataStart=${dataStart}`);

if (command === "list") {
	const pattern = rest[0] === void 0 ? null : new RegExp(rest[0], "i");
	for (const file of files) {
		if (pattern === null || pattern.test(file.path)) console.log(`${String(file.size).padStart(9)}  ${file.path}`);
	}
} else if (command === "cat") {
	const target = rest[0];
	const outFile = rest[1];
	const file = files.find((entry) => entry.path === target);
	if (file === void 0) {
		console.error(`not found: ${target}`);
		process.exit(1);
	}
	const buffer = Buffer.alloc(file.size);
	readSync(fd, buffer, 0, file.size, dataStart + file.offset);
	if (outFile === void 0) process.stdout.write(buffer);
	else {
		writeFileSync(outFile, buffer);
		console.log(`${file.size} B -> ${outFile}`);
	}
} else {
	console.error(`unknown command: ${command}`);
	process.exit(2);
}
closeSync(fd);
