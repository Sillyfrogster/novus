import { useEffect, useRef } from "react";

export function useDialog(modal = true) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || dialog.open) return;
    if (modal) dialog.showModal();
    else dialog.show();

    return () => {
      if (dialog.open) dialog.close();
    };
  }, [modal]);

  return ref;
}
