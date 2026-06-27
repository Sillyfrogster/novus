/** Narrow an unknown thrown value to a human-readable string. */
export function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
