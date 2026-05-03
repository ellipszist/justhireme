import { useEffect } from "react";

export function useKeyboardShortcuts(config: {
  onEscape: () => void;
  onCmdK: () => void;
  onCmdComma: () => void;
}) {
  const { onEscape, onCmdK, onCmdComma } = config;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === "Escape") {
        onEscape();
      }
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onCmdK();
      }
      if (mod && e.key === ",") {
        e.preventDefault();
        onCmdComma();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onEscape, onCmdK, onCmdComma]);
}
