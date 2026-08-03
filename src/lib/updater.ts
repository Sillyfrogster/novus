import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";

import { isDesktop } from "./platform";

/**
 * Thin isolation layer over the Tauri updater/process plugins.
 */

export type { Update };

/** Resolves to an `Update` when one is available, or `null` when up to date. */
export function checkForUpdate(): Promise<Update | null> {
  if (!isDesktop) return Promise.resolve(null);
  return check();
}

/**
 * Download and install an update.
 */
export async function downloadAndInstall(
  update: Update,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  if (!isDesktop) throw new Error("Updates are managed by the mobile app store.");
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
  if (!isDesktop) return Promise.reject(new Error("Relaunch is not available on mobile."));
  return relaunch();
}
