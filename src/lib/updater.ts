import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";

/**
 * Thin isolation layer over the Tauri updater/process plugins.
 */

export type { Update };

/** Resolves to an `Update` when one is available, or `null` when up to date. */
export function checkForUpdate(): Promise<Update | null> {
  return check();
}

/**
 * Download and install an update.
 */
export async function downloadAndInstall(
  update: Update,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  let contentLength = 0;
  let downloaded = 0;

  await update.downloadAndInstall((event: DownloadEvent) => {
    switch (event.event) {
      case "Started":
        contentLength = event.data.contentLength ?? 0;
        onProgress?.(0);
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        if (contentLength > 0) onProgress?.(Math.min(1, downloaded / contentLength));
        break;
      case "Finished":
        onProgress?.(1);
        break;
    }
  });
}

/** Relaunch the app so the installed update takes effect. */
export function relaunchApp(): Promise<void> {
  return relaunch();
}
