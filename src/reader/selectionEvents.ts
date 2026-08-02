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
  const releaseTargets = releaseTarget === target ? [target] : [target, releaseTarget];

  target.addEventListener("mousedown", start);
  target.addEventListener("selectionchange", finishAfterSelectionSettles);
  for (const release of releaseTargets) {
    release.addEventListener("mouseup", finish);
    release.addEventListener("pointerup", finish);
    release.addEventListener("touchend", finish);
    release.addEventListener("dragend", finish);
    release.addEventListener("keyup", finish);
    release.addEventListener("blur", finishAfterSelectionSettles);
  }

  return () => {
    cancelPendingFinish();
    target.removeEventListener("mousedown", start);
    target.removeEventListener("selectionchange", finishAfterSelectionSettles);
    for (const release of releaseTargets) {
      release.removeEventListener("mouseup", finish);
      release.removeEventListener("pointerup", finish);
      release.removeEventListener("touchend", finish);
      release.removeEventListener("dragend", finish);
      release.removeEventListener("keyup", finish);
      release.removeEventListener("blur", finishAfterSelectionSettles);
    }
  };
}
