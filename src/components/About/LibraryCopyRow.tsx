import { open, save } from "@tauri-apps/plugin-dialog";
import { ArchiveRestore, BookCopy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  cancelLibraryRestore,
  commitLibraryRestore,
  createLibraryBackup,
  prepareLibraryRestore,
  type RestoreSummary,
} from "../../lib/ipc";
import { currentPreferences } from "../../lib/preferences";
import { relaunchApp } from "../../lib/updater";
import { useLibrary } from "../../store/library";
import { ConfirmDialog } from "../ConfirmDialog";
import styles from "./AboutPanel.module.css";

type Activity = "idle" | "backingUp" | "preparing" | "cancelling" | "restarting";

interface Notice {
  tone: "quiet" | "error";
  text: string;
}

interface PreparedCopy {
  name: string;
  summary: RestoreSummary;
}

export function LibraryCopyRow() {
  const [activity, setActivity] = useState<Activity>("idle");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [prepared, setPrepared] = useState<PreparedCopy | null>(null);
  const mounted = useRef(true);
  const busy = activity !== "idle";

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      void cancelLibraryRestore().catch(() => {
        showBackgroundNotice(
          "Novus could not cancel the restore. Restart Novus and try again.",
          "error",
          true,
        );
      });
    };
  }, []);

  async function backUp() {
    let destination: string | null;
    try {
      destination = await save({
        defaultPath: `Novus Library ${today()}.novus-backup`,
        filters: [{ name: "Novus library copy", extensions: ["novus-backup"] }],
      });
    } catch {
      if (!mounted.current) return;
      setNotice({
        tone: "error",
        text: "Novus could not open the save dialog. Please try again.",
      });
      return;
    }
    if (!destination || !mounted.current) return;

    setActivity("backingUp");
    setNotice({ tone: "quiet", text: "Saving your library copy…" });
    try {
      await createLibraryBackup(destination, currentPreferences());
      if (!mounted.current) {
        showBackgroundNotice("Your library copy is saved.", "success", false);
        return;
      }
      setNotice({ tone: "quiet", text: "Your library copy is saved." });
    } catch {
      if (!mounted.current) {
        showBackgroundNotice(
          "Novus could not save this library copy. Choose another location and try again.",
          "error",
          true,
        );
        return;
      }
      setNotice({
        tone: "error",
        text: "Novus could not save this library copy. Choose another location and try again.",
      });
    } finally {
      if (mounted.current) setActivity("idle");
    }
  }

  async function chooseRestore() {
    let source: string | string[] | null;
    try {
      source = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "Novus library copy", extensions: ["novus-backup"] }],
      });
    } catch {
      if (!mounted.current) return;
      setNotice({
        tone: "error",
        text: "Novus could not open the file picker. Please try again.",
      });
      return;
    }
    if (!source || Array.isArray(source) || !mounted.current) return;

    setActivity("preparing");
    setNotice({ tone: "quiet", text: "Checking this library copy…" });
    try {
      const summary = await prepareLibraryRestore(source);
      if (!mounted.current) {
        await cancelLibraryRestore().catch(() => {
          showBackgroundNotice(
            "Novus could not cancel the restore. Restart Novus and try again.",
            "error",
            true,
          );
        });
        return;
      }
      setPrepared({ name: fileName(source), summary });
      setNotice(null);
    } catch {
      if (!mounted.current) return;
      setNotice({
        tone: "error",
        text: "Novus could not read this library copy. The file may be damaged or from a newer version of Novus.",
      });
    } finally {
      if (mounted.current) setActivity("idle");
    }
  }

  async function cancelRestore() {
    setPrepared(null);
    setActivity("cancelling");
    setNotice({ tone: "quiet", text: "Cancelling the restore…" });
    try {
      await cancelLibraryRestore();
      setNotice(null);
    } catch {
      setNotice({
        tone: "error",
        text: "Novus could not cancel the restore. Restart Novus and try again.",
      });
    } finally {
      setActivity("idle");
    }
  }

  async function restore() {
    setPrepared(null);
    setActivity("restarting");
    setNotice({ tone: "quiet", text: "Preparing to restart Novus…" });
    try {
      await commitLibraryRestore();
    } catch {
      setActivity("idle");
      setNotice({
        tone: "error",
        text: "Novus could not start the restore. Your current library has not changed.",
      });
      return;
    }

    try {
      await relaunchApp();
    } catch {
      setActivity("idle");
      setNotice({
        tone: "error",
        text: "The library copy is ready. Restart Novus to finish restoring it.",
      });
    }
  }

  return (
    <>
      <section className={styles.libraryCopy} aria-labelledby="library-copy-title">
        <h2 id="library-copy-title" className={styles.sectionTitle}>
          Library copy
        </h2>
        <p
          className={styles.libraryCopyText}
          data-tone={notice?.tone}
        >
          {notice?.text ??
            "Keep a portable copy of your books and reading history. The copy is not encrypted."}
        </p>
        <span
          className={styles.visuallyHidden}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {notice?.tone === "quiet" ? notice.text : ""}
        </span>
        <span
          className={styles.visuallyHidden}
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
        >
          {notice?.tone === "error" ? notice.text : ""}
        </span>
        <div className={styles.libraryCopyActions}>
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={backUp}
            disabled={busy}
          >
            <BookCopy size={14} strokeWidth={1.7} />
            {activity === "backingUp" ? "Saving…" : "Back up"}
          </button>
          <button
            type="button"
            className={styles.ghostBtn}
            onClick={chooseRestore}
            disabled={busy}
          >
            <ArchiveRestore size={14} strokeWidth={1.7} />
            {activity === "preparing" ? "Checking…" : "Restore"}
          </button>
        </div>
      </section>

      {prepared && (
        <ConfirmDialog
          title="Replace this library?"
          body={`${prepared.name} was saved ${formatBackupDate(prepared.summary.backupCreatedAt)} and contains ${bookCount(prepared.summary.bookCount)}. Replacing your library will replace its books, collections, highlights, and reading history. Novus will restart. Your current library will be kept until the restored copy opens successfully.`}
          confirmLabel="Replace and restart"
          onConfirm={restore}
          onCancel={cancelRestore}
        />
      )}
    </>
  );
}

function today(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || "Selected library copy";
}

function formatBackupDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp * 1000));
}

function bookCount(count: number): string {
  return count === 1 ? "one book" : `${count} books`;
}

function showBackgroundNotice(
  text: string,
  tone: "error" | "success",
  persistent: boolean,
): void {
  useLibrary.getState().showAppNotice({ text, tone, persistent });
}
