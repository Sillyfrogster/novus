import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const VERSION = "v0.1.1";
const REPO = "Sillyfrogster/novus-voice";

const lenient = process.argv.includes("--lenient");
const targetFlag = process.argv.indexOf("--target");
const target =
  (targetFlag !== -1 && process.argv[targetFlag + 1]) ||
  process.env.TAURI_ENV_TARGET_TRIPLE ||
  /host: (\S+)/.exec(execFileSync("rustc", ["-vV"]).toString())?.[1];
if (!target) throw new Error("could not determine target triple (pass --target <triple>)");

const ext = target.includes("windows") ? ".exe" : "";
const asset = `novus-voice-${target}${ext}`;
const root = new URL("..", import.meta.url).pathname;
const destDir = join(root, "src-tauri", "binaries");
const dest = join(destDir, asset);
const stampPath = join(destDir, `.${asset}.stamp.json`);

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function isAlreadyStaged() {
  if (!existsSync(dest) || !existsSync(stampPath)) return false;
  try {
    const stamp = JSON.parse(readFileSync(stampPath, "utf8"));
    return stamp.version === VERSION && sha256(readFileSync(dest)) === stamp.sha256;
  } catch {
    return false;
  }
}

async function fetchBytes(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `GET ${url} → ${res.status} ${res.statusText}` +
        (res.status === 404
          ? ` (does the ${VERSION} release exist on ${REPO} with an asset for ${target}?)`
          : ""),
    );
  }
  return Buffer.from(await res.arrayBuffer());
}

async function stage() {
  const base = `https://github.com/${REPO}/releases/download/${VERSION}`;
  console.log(`fetching ${asset} @ ${VERSION}`);
  const [bin, sum] = await Promise.all([
    fetchBytes(`${base}/${asset}`),
    fetchBytes(`${base}/${asset}.sha256`),
  ]);

  const expected = sum.toString().trim().split(/\s+/)[0];
  const actual = sha256(bin);
  if (actual !== expected) {
    throw new Error(`checksum mismatch for ${asset}: expected ${expected}, got ${actual}`);
  }

  mkdirSync(destDir, { recursive: true });
  writeFileSync(dest, bin);
  if (!ext) chmodSync(dest, 0o755);
  writeFileSync(stampPath, JSON.stringify({ version: VERSION, sha256: actual }));
  console.log(`staged ${dest} (sha256 verified)`);
}

if (isAlreadyStaged()) {
  console.log(`sidecar ${asset} @ ${VERSION} already staged`);
} else {
  try {
    await stage();
  } catch (err) {
    if (lenient && existsSync(dest)) {
      console.warn(`sidecar fetch failed: ${err.message}`);
    } else {
      throw err;
    }
  }
}
