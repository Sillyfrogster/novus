import { describe, expect, test } from "bun:test";

import { createLibraryCopy } from "../src/lib/libraryCopy";

type LibraryCopyBackend = Parameters<typeof createLibraryCopy>[0];

const restoreSummary = {
  backupCreatedAt: 1_700_000_000_000,
  bookCount: 2,
  fileCount: 5,
};

/** Every method resolves by default; a test overrides only the call it records. */
function fakeBackend(overrides: Partial<LibraryCopyBackend> = {}): LibraryCopyBackend {
  return {
    save: async () => ({ createdAt: 1, bookCount: 0, fileCount: 0, byteCount: 0 }),
    prepare: async () => restoreSummary,
    commit: async () => undefined,
    cancel: async () => undefined,
    status: async () => null,
    finish: async () => undefined,
    rollback: async () => undefined,
    relaunch: async () => undefined,
    ...overrides,
  };
}

describe("library copy restore confirmation", () => {
  test("prepare returns the restore summary and does not commit", async () => {
    const calls: string[] = [];
    const copy = createLibraryCopy(
      fakeBackend({
        prepare: async (path) => {
          calls.push(`prepare:${path}`);
          return restoreSummary;
        },
        commit: async () => {
          calls.push("commit");
        },
      }),
      () => {
        calls.push("reload");
      },
    );

    const summary = await copy.prepare("/backups/novus.zip");

    expect(summary).toEqual(restoreSummary);
    expect(calls).toEqual(["prepare:/backups/novus.zip"]);
  });

  test("install commits the prepared copy and then relaunches", async () => {
    const calls: string[] = [];
    const copy = createLibraryCopy(
      fakeBackend({
        commit: async () => {
          calls.push("commit");
        },
        relaunch: async () => {
          calls.push("relaunch");
        },
      }),
      () => {
        calls.push("reload");
      },
    );

    const installed = await copy.install();

    expect(installed).toBe(true);
    expect(calls).toEqual(["commit", "relaunch"]);
  });

  test("install reports false when relaunch rejects after the commit", async () => {
    let commits = 0;
    const copy = createLibraryCopy(
      fakeBackend({
        commit: async () => {
          commits += 1;
        },
        relaunch: async () => {
          throw new Error("relaunch failed");
        },
      }),
      () => undefined,
    );

    const installed = await copy.install();

    expect(installed).toBe(false);
    expect(commits).toBe(1);
  });

  test("cancel calls the backend cancel and never commits", async () => {
    let cancels = 0;
    let commits = 0;
    const copy = createLibraryCopy(
      fakeBackend({
        cancel: async () => {
          cancels += 1;
        },
        commit: async () => {
          commits += 1;
        },
      }),
      () => undefined,
    );

    await copy.cancel();

    expect(cancels).toBe(1);
    expect(commits).toBe(0);
  });

  test("resume with no pending restore reports ready", async () => {
    let opened = 0;
    const copy = createLibraryCopy(fakeBackend({ status: async () => null }), () => undefined);

    const startup = await copy.resume(async () => {
      opened += 1;
      return true;
    });

    expect(startup).toEqual({ ready: true });
    expect(opened).toBe(1);
  });
});
