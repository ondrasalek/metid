import { useEffect, useRef } from "react";

// App-level commands. They come from the native menu bar (via the Rust
// `menu-command` event) or, outside Tauri, from browser keyboard shortcuts.
// Whichever view is mounted and registered for a command handles it, so the
// same code path serves menu click, accelerator and button.
export type Command =
  | "open"
  | "save"
  | "revert"
  | "add"
  | "find"
  | "view-single"
  | "view-batch"
  | "settings";

const EVENT = "metid:command";

export function runCommand(command: Command) {
  window.dispatchEvent(new CustomEvent<Command>(EVENT, { detail: command }));
}

export function useCommands(handlers: Partial<Record<Command, () => void>>) {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });
  useEffect(() => {
    function onCommand(e: Event) {
      ref.current[(e as CustomEvent<Command>).detail]?.();
    }
    window.addEventListener(EVENT, onCommand);
    return () => window.removeEventListener(EVENT, onCommand);
  }, []);
}
