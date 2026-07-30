import { MARK_PATH, MARK_VIEWBOX } from "../lib/mark";

interface MarkProps {
  size?: number;
}

const VB_W = MARK_VIEWBOX.width;
const VB_H = MARK_VIEWBOX.height;

export function Mark({ size = 22 }: MarkProps) {
  const width = Math.round((size * VB_W) / VB_H);
  return (
    <svg
      width={width}
      height={size}
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      fill="currentColor"
      style={{ flex: "0 0 auto" }}
      aria-hidden="true"
    >
      <path fillRule="evenodd" d={MARK_PATH} />
    </svg>
  );
}
