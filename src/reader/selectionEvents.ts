export interface SelectionEventTarget {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

interface SelectionEventHandlers {
  onStart: () => void;
  onFinish: () => void;
}

const SELECTION_SETTLE_MS = 60;

export function bindSelectionEvents(
  target: SelectionEventTarget,
  { onStart, onFinish }: SelectionEventHandlers,
): () => void {
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  const cancelPendingFinish = () => {
    if (settleTimer !== null) clearTimeout(settleTimer);
    settleTimer = null;
  };
  const start = () => {
    cancelPendingFinish();
    onStart();
  };
  const finish = () => {
    cancelPendingFinish();
    onFinish();
  };
  const finishAfterSelectionSettles = () => {
    cancelPendingFinish();
    settleTimer = setTimeout(finish, SELECTION_SETTLE_MS);
  };

  target.addEventListener("mousedown", start);
  target.addEventListener("mouseup", finish);
  target.addEventListener("keyup", finish);
  target.addEventListener("selectionchange", finishAfterSelectionSettles);

  return () => {
    cancelPendingFinish();
    target.removeEventListener("mousedown", start);
    target.removeEventListener("mouseup", finish);
    target.removeEventListener("keyup", finish);
    target.removeEventListener("selectionchange", finishAfterSelectionSettles);
  };
}
