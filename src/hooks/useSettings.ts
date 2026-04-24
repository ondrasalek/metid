import { useState } from "react";

const STORAGE_KEY = "metid_settings_v1";

export interface Settings {
  keepBackups: boolean;
  defaultBatchColumns: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  keepBackups: false,
  defaultBatchColumns: ["Title", "Artist", "Description"],
};

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Settings>;
        return { ...DEFAULT_SETTINGS, ...parsed };
      }
    } catch {
      // ignore parse errors — fall through to defaults
    }
    return DEFAULT_SETTINGS;
  });

  function updateSettings(patch: Partial<Settings>) {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore storage write errors
      }
      return next;
    });
  }

  return { settings, updateSettings };
}
