interface SelectionRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

interface ViewportSize {
  width: number;
  height: number;
}

const BAR_WIDTH = 184;
const BAR_HEIGHT = 40;
const GAP = 12;

export function placeHighlightBar(rect: SelectionRect, viewport: ViewportSize) {
  const midX = (rect.left + rect.right) / 2;
  const left = Math.max(
    GAP,
    Math.min(viewport.width - BAR_WIDTH - GAP, midX - BAR_WIDTH / 2),
  );
  const below = rect.top < BAR_HEIGHT + GAP * 2;
  const desiredTop = below ? rect.bottom + GAP : rect.top - GAP - BAR_HEIGHT;
  const top = Math.max(
    GAP,
    Math.min(viewport.height - BAR_HEIGHT - GAP, desiredTop),
  );
  return { left, top };
}
