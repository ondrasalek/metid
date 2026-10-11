import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { runCommand, type Command } from "../lib/commands";

// True on macOS — drives whether ⌘ or Ctrl is the platform "command" modifier
// when rendering shortcut hints.
export const IS_MAC =
  typeof navigator !== "undefined" && navigator.platform.toLowerCase().includes("mac");

// Human-readable modifier symbol for hints ("⌘S" on macOS, "Ctrl+S" elsewhere).
export const MOD_LABEL = IS_MAC ? "⌘" : "Ctrl+";

const KEYMAP: Record<string, Command> = {
  o: "open",
  s: "save",
  t: "add",
  f: "find",
  "1": "view-single",
  "2": "view-batch",
  ",": "settings",
};

// Inside Tauri the native menu owns every accelerator (and emits commands), so
// binding keys here too would fire each command twice. This fallback only
// exists so the UI stays usable in a plain browser during `npm run dev`.
export function useBrowserShortcuts() {
  useEffect(() => {
    if (isTauri()) return;
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const command = KEYMAP[e.key.toLowerCase()];
      if (!command) return;
      e.preventDefault();
      runCommand(command);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
