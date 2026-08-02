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
  releaseTarget: SelectionEventTarget = target,
): () => void {
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let lastFinishAt = Number.NEGATIVE_INFINITY;
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
    const now = Date.now();
    if (now - lastFinishAt < 16) return;
    lastFinishAt = now;
    onFinish();
  };
  const finishAfterSelectionSettles = () => {
    cancelPendingFinish();
    settleTimer = setTimeout(finish, SELECTION_SETTLE_MS);
  };

  target.addEventListener("mousedown", start);
  target.addEventListener("selectionchange", finishAfterSelectionSettles);
  releaseTarget.addEventListener("mouseup", finish);
  releaseTarget.addEventListener("pointerup", finish);
  releaseTarget.addEventListener("touchend", finish);
  releaseTarget.addEventListener("dragend", finish);
  releaseTarget.addEventListener("keyup", finish);
  releaseTarget.addEventListener("blur", finishAfterSelectionSettles);

  return () => {
    cancelPendingFinish();
    target.removeEventListener("mousedown", start);
    target.removeEventListener("selectionchange", finishAfterSelectionSettles);
    releaseTarget.removeEventListener("mouseup", finish);
    releaseTarget.removeEventListener("pointerup", finish);
    releaseTarget.removeEventListener("touchend", finish);
    releaseTarget.removeEventListener("dragend", finish);
    releaseTarget.removeEventListener("keyup", finish);
    releaseTarget.removeEventListener("blur", finishAfterSelectionSettles);
  };
}
