import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Toaster } from "sonner";
import { Download } from "lucide-react";
import { useSettings } from "./hooks/useSettings";
import { useBrowserShortcuts } from "./hooks/useHotkeys";
import { useApplyTheme, resolveTheme, ResolvedTheme } from "./hooks/useTheme";
import { runCommand, useCommands, type Command } from "./lib/commands";
import { confirmDiscard } from "./lib/metadata";
import { Sidebar } from "./components/Sidebar";
import { SingleFileView } from "./components/SingleFileView";
import { BatchView } from "./components/BatchView";
import { SettingsView } from "./components/SettingsView";

export type Mode = "single" | "batch" | "settings";

export default function App() {
  const [mode, setMode] = useState<Mode>("single");
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [pendingDropPaths, setPendingDropPaths] = useState<string[] | null>(null);
  const { settings, updateSettings } = useSettings();
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    resolveTheme(settings.theme),
  );
  useApplyTheme(settings.theme, setResolvedTheme);
  useBrowserShortcuts();

  // Unsaved-edit tracking, lifted out of the views so view switching and the
  // window-close handler can guard against silent data loss. The ref mirrors
  // the state for the close listener, which is registered once.
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(dirty);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);

  async function switchMode(next: Mode) {
    if (next === mode) return;
    if (dirty && !(await confirmDiscard("Switching views will discard your unsaved changes."))) {
      return;
    }
    setMode(next);
  }

  useCommands({
    "view-single": () => switchMode("single"),
    "view-batch": () => switchMode("batch"),
    settings: () => switchMode("settings"),
  });

  // Native menu bar → command bus.
  useEffect(() => {
    if (!isTauri()) return;
    const unlisten = listen<string>("menu-command", (e) => runCommand(e.payload as Command));
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // Intercept the OS close request while edits are pending; re-issue the close
  // only after the user confirms.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    const win = getCurrentWebviewWindow();
    win
      .onCloseRequested(async (event) => {
        if (!dirtyRef.current) return;
        event.preventDefault();
        if (await confirmDiscard("You have unsaved changes. Quit anyway?")) {
          unlisten?.();
          await win.destroy();
        }
      })
      .then((fn) => { unlisten = fn; });
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    getCurrentWebviewWindow()
      .onDragDropEvent((e) => {
        if (e.payload.type === "over") {
          setIsDraggingOver(true);
        } else if (e.payload.type === "drop") {
          setIsDraggingOver(false);
          if (e.payload.paths.length > 0) setPendingDropPaths(e.payload.paths);
        } else {
          setIsDraggingOver(false);
        }
      })
      .then((fn) => { unlisten = fn; });
    return () => unlisten?.();
  }, []);

  // The webview's default context menu (Reload, Inspect…) is web-page chrome;
  // keep it in dev builds and for text fields, where Copy/Paste are useful.
  useEffect(() => {
    if (import.meta.env.DEV) return;
    function onContextMenu(e: MouseEvent) {
      if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
    }
    window.addEventListener("contextmenu", onContextMenu);
    return () => window.removeEventListener("contextmenu", onContextMenu);
  }, []);

  return (
    <div className="relative flex h-screen w-screen overflow-hidden bg-transparent font-sans text-[13px] text-fg selection:bg-blue-500/30">
      <Toaster theme={resolvedTheme} position="bottom-right" className="font-sans" />

      <Sidebar mode={mode} onSwitch={switchMode} />

      <main className="relative min-w-0 flex-1 bg-app">
        {mode === "single" ? (
          <SingleFileView
            keepBackups={settings.keepBackups}
            droppedFiles={pendingDropPaths}
            onDropHandled={() => setPendingDropPaths(null)}
            onDirtyChange={setDirty}
          />
        ) : mode === "batch" ? (
          <BatchView
            keepBackups={settings.keepBackups}
            defaultColumns={settings.defaultBatchColumns}
            droppedFiles={pendingDropPaths}
            onDropHandled={() => setPendingDropPaths(null)}
            onDirtyChange={setDirty}
          />
        ) : (
          <SettingsView settings={settings} onUpdate={updateSettings} />
        )}

        {isDraggingOver && mode !== "settings" && (
          <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-app/80 p-4 backdrop-blur-sm">
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-blue-500/60 bg-blue-500/5">
              <Download size={32} className="text-blue-500" strokeWidth={1.5} />
              <p className="text-[15px] font-semibold text-blue-600 dark:text-blue-300">Drop to open</p>
              <p className="text-xs text-fg-3">
                {mode === "single" ? "The first file will be opened" : "Files will be added to the table"}
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
