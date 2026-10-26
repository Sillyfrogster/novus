import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const CONFIG_PATH = join(import.meta.dir, "..", "src-tauri", "tauri.conf.json");

interface SecurityBlock {
  csp: unknown;
  devCsp?: unknown;
  dangerousDisableAssetCspModification?: unknown;
  assetProtocol: { enable: boolean; scope: string[] };
}

function readSecurity(): SecurityBlock {
  const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as {
    app: { security: SecurityBlock };
  };
  return config.app.security;
}

function readPolicy(): string {
  const csp = readSecurity().csp;
  if (typeof csp !== "string") {
    throw new Error(`app.security.csp must be a string, got ${JSON.stringify(csp)}`);
  }
  return csp;
}

/** Map each directive name to its source list, splitting on semicolons. */
function directivesOf(policy: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const part of policy.split(";")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    const [name, ...sources] = tokens;
    if (!directives.has(name)) directives.set(name, sources);
  }
  return directives;
}

describe("packaged CSP policy", () => {
  test("app.security.csp is a non-empty string, not null", () => {
    const policy = readPolicy();
    expect(policy.trim().length).toBeGreaterThan(0);
  });

  test("policy names every origin form the app uses", () => {
    const directives = directivesOf(readPolicy());
    expect(directives.get("connect-src")).toEqual(
      expect.arrayContaining(["ipc:", "http://ipc.localhost"]),
    );
    expect(directives.get("img-src")).toEqual(
      expect.arrayContaining(["asset:", "http://asset.localhost"]),
    );
    expect(directives.get("frame-src")).toEqual(
      expect.arrayContaining(["novus-epub:", "http://novus-epub.localhost"]),
    );
  });

  test("policy has the restrictive baseline directives", () => {
    const directives = directivesOf(readPolicy());
    expect(directives.get("default-src")).toEqual(["'self'"]);
    expect(directives.get("script-src")).toEqual(["'self'"]);
    expect(directives.get("object-src")).toEqual(["'none'"]);
    expect(directives.get("base-uri")).toEqual(["'none'"]);
  });

  test("no directive name appears twice in the policy", () => {
    const names = readPolicy()
      .split(";")
      .map((part) => part.trim().split(/\s+/)[0])
      .filter((name): name is string => Boolean(name));
    const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
    expect(duplicates).toEqual([]);
  });

  test("script-src is exactly 'self' and the asset-CSP fallback cannot widen it", () => {
    const directives = directivesOf(readPolicy());
    expect(directives.get("script-src")).toEqual(["'self'"]);

    const fallback = readSecurity().dangerousDisableAssetCspModification;
    if (fallback === undefined) return;
    expect(fallback).toEqual(["style-src"]);
  });

  test("devCsp is null and the cover asset scope is unchanged", () => {
    const security = readSecurity();
    expect(security.devCsp).toBeNull();
    expect(security.assetProtocol.scope).toEqual(["$APPDATA/covers/**"]);
  });
});
