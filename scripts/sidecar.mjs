import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "v0.1.1";
const REPO = "Sillyfrogster/novus-voice";

const MAX_ATTEMPTS = 4;
const REQUEST_TIMEOUT_MS = 30_000;
const RETRY_BASE_MS = 500;

const lenient = process.argv.includes("--lenient");
const targetFlag = process.argv.indexOf("--target");
const target =
  (targetFlag !== -1 && process.argv[targetFlag + 1]) ||
  process.env.TAURI_ENV_TARGET_TRIPLE ||
  /host: (\S+)/.exec(execFileSync("rustc", ["-vV"]).toString())?.[1];
if (!target) throw new Error("could not determine target triple (pass --target <triple>)");

const ext = target.includes("windows") ? ".exe" : "";
const asset = `novus-voice-${target}${ext}`;
const root = fileURLToPath(new URL("..", import.meta.url));
const destDir = join(root, "src-tauri", "binaries");
const dest = join(destDir, asset);
const stampPath = join(destDir, `.${asset}.stamp.json`);

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!res.ok) {
        const hint =
          res.status === 404
            ? ` (does the ${VERSION} release exist on ${REPO} with an asset for ${target}?)`
            : "";
        const err = new Error(`GET ${url} → ${res.status} ${res.statusText}${hint}`);
        err.retryable = res.status === 429 || res.status >= 500;
        throw err;
      }
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      lastErr = err;
      const retryable = err.retryable ?? true;
      if (!retryable || attempt === MAX_ATTEMPTS) break;
      const delay = RETRY_BASE_MS * 2 ** (attempt - 1);
      console.warn(`  attempt ${attempt}/${MAX_ATTEMPTS} failed: ${err.message} — retrying in ${delay}ms`);
      await sleep(delay);
    }
  }
  throw lastErr;
}

function writeAtomic(path, bytes, mode) {
  const tmp = `${path}.tmp`;
  try {
    writeFileSync(tmp, bytes);
    if (mode !== undefined) chmodSync(tmp, mode);
    renameSync(tmp, path);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
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
  writeAtomic(dest, bin, ext ? undefined : 0o755);
  writeAtomic(stampPath, JSON.stringify({ version: VERSION, sha256: actual }));
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
