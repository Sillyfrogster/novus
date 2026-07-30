type RequestFrame = (callback: FrameRequestCallback) => number;
type CancelFrame = (handle: number) => void;

export class FrameBatch {
  readonly #request: RequestFrame;
  readonly #cancel: CancelFrame;
  #handle: number | null = null;
  #task: (() => void) | null = null;

  constructor(
    request: RequestFrame = (callback) => requestAnimationFrame(callback),
    cancel: CancelFrame = (handle) => cancelAnimationFrame(handle),
  ) {
    this.#request = request;
    this.#cancel = cancel;
  }

  schedule(task: () => void): void {
    this.#task = task;
    if (this.#handle !== null) return;

    this.#handle = this.#request(() => {
      this.#handle = null;
      const latest = this.#task;
      this.#task = null;
      latest?.();
    });
  }

  clear(): void {
    if (this.#handle !== null) this.#cancel(this.#handle);
    this.#handle = null;
    this.#task = null;
  }
}
