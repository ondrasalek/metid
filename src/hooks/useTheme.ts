import { useEffect } from "react";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

// Resolves "system" to the OS preference; passes "light"/"dark" through.
export function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme === "system") {
    return typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return theme;
}

// Applies the resolved theme to <html>: toggles the `.dark` class (which flips
// the CSS color tokens) and sets `color-scheme` so native form controls and
// scrollbars match. When in "system" mode it also re-applies on OS changes.
// `onResolved` lets callers mirror the resolved value into React state (e.g. to
// theme the toast layer).
export function useApplyTheme(
  theme: Theme,
  onResolved?: (resolved: ResolvedTheme) => void,
) {
  useEffect(() => {
    function apply() {
      const resolved = resolveTheme(theme);
      const root = document.documentElement;
      root.classList.toggle("dark", resolved === "dark");
      root.style.colorScheme = resolved;
      onResolved?.(resolved);
    }
    apply();
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]); // eslint-disable-line react-hooks/exhaustive-deps
}
