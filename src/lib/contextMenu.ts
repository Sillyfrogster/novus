interface ContextMenuTarget {
  addEventListener(type: "contextmenu", listener: EventListener): void;
  removeEventListener(type: "contextmenu", listener: EventListener): void;
}

export function blockNativeContextMenu(target: ContextMenuTarget): () => void {
  const prevent = (event: Event) => event.preventDefault();
  target.addEventListener("contextmenu", prevent);
  return () => target.removeEventListener("contextmenu", prevent);
}
