import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useState } from "react";

/**
 * The running application's version.
 */
let cached: string | null = null;

export async function appVersion(): Promise<string> {
  if (cached === null) cached = await getVersion();
  return cached;
}

/** React hook returning the app version, empty string until it resolves. */
export function useAppVersion(): string {
  const [version, setVersion] = useState(cached ?? "");
  useEffect(() => {
    let active = true;
    appVersion().then((v) => {
      if (active) setVersion(v);
    });
    return () => {
      active = false;
    };
  }, []);
  return version;
}
