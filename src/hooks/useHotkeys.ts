import { useEffect } from "react";

type Handler = (e: KeyboardEvent) => void;

// True on macOS — drives whether ⌘ or Ctrl is the platform "command" modifier,
// both for matching key events and for rendering shortcut hints in tooltips.
export const IS_MAC =
  typeof navigator !== "undefined" &&
  navigator.platform.toLowerCase().includes("mac");

// Human-readable modifier symbol for tooltips ("⌘S" on macOS, "Ctrl+S" elsewhere).
export const MOD_LABEL = IS_MAC ? "⌘" : "Ctrl+";

// Registers global Cmd/Ctrl + <key> shortcuts. `handlers` is keyed by the
// lowercase key (e.g. "s", "o"); the platform command modifier must be held.
//
// Intentionally no dependency array: the effect re-subscribes every render so
// the handlers always close over fresh state, sidestepping stale-closure bugs
// in views whose save/open callbacks depend on changing local state.
export function useCmdKey(handlers: Record<string, Handler>) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const handler = handlers[e.key.toLowerCase()];
      if (handler) handler(e);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });
}
