import type { TocItem } from "./types";

function fileName(href: string): string {
  return href.split("/").pop() ?? href;
}

export function resolveContentsTarget(
  contents: readonly TocItem[],
  target: string,
): string {
  const targetName = fileName(target);

  for (const item of contents) {
    if (item.href && fileName(item.href) === targetName) return item.href;
    const nested = resolveContentsTarget(item.subitems ?? [], target);
    if (nested !== target) return nested;
  }

  return target;
}
