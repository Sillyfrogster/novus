type ErrorSink = (text: string) => void;

let sink: ErrorSink | null = null;

/** Log a failed save with its raw error, then show the user-facing text in the notice slot. */
export function reportPersistentError(text: string, error: unknown): void {
  console.error(text, error);
  sink?.(text);
}

/** Connect the notice slot. Stores cannot import the library store, so it registers here. */
export function registerErrorSink(nextSink: ErrorSink): void {
  sink = nextSink;
}
