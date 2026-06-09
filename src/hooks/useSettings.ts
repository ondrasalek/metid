import { useEffect, useRef, useState } from "react";
import { load, type Store } from "@tauri-apps/plugin-store";
import { Theme } from "./useTheme";

// localStorage acts as a synchronous cache so the pre-paint theme bootstrap in
// index.html (and the first React render) never have to await anything. The
// Tauri store file is the durable source of truth — it lives outside the
// webview's storage, so it survives a webview data wipe. On mount we reconcile:
// the store wins if present, otherwise it is seeded from the cache.
const STORAGE_KEY = "metid_settings_v1";
const STORE_FILE = "settings.json";
const STORE_KEY = "settings";

export interface Settings {
  keepBackups: boolean;
  defaultBatchColumns: string[];
  theme: Theme;
}

export const DEFAULT_SETTINGS: Settings = {
  keepBackups: false,
  defaultBatchColumns: ["Title", "Artist", "Description"],
  theme: "system",
};

function readCache(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    // ignore parse errors — fall through to defaults
  }
  return DEFAULT_SETTINGS;
}

function writeCache(settings: Settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore storage write errors
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(() => readCache());
  const storeRef = useRef<Store | null>(null);

  // Reconcile with the durable Tauri store once it is available. In a plain
  // browser (dev without the Tauri runtime) `load` throws and we silently keep
  // the localStorage-backed state.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const store = await load(STORE_FILE);
        if (cancelled) return;
        storeRef.current = store;
        const stored = await store.get<Settings>(STORE_KEY);
        if (cancelled) return;
        if (stored) {
          const merged = { ...DEFAULT_SETTINGS, ...stored };
          setSettings(merged);
          writeCache(merged);
        } else {
          // First run with the store present — seed it from the cache.
          await store.set(STORE_KEY, readCache());
          await store.save();
        }
      } catch {
        // No Tauri runtime — localStorage remains the source of truth.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function updateSettings(patch: Partial<Settings>) {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      writeCache(next);
      // Persist durably; a no-op until/unless the store has loaded.
      storeRef.current
        ?.set(STORE_KEY, next)
        .then(() => storeRef.current?.save())
        .catch(() => {});
      return next;
    });
  }

  return { settings, updateSettings };
}
