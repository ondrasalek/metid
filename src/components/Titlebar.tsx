import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";

export function Titlebar() {
  const win = getCurrentWindow();

  return (
    <div
      data-tauri-drag-region
      className="h-8 w-full flex-shrink-0 flex items-center justify-between select-none bg-app border-b border-line/80 z-50"
    >
      {/* Brand — marked as drag region so clicking the logo/text also moves the window */}
      <div data-tauri-drag-region className="flex items-center gap-2 pl-3 pointer-events-none">
        <div className="w-4 h-4 rounded bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow shadow-blue-500/20">
          <span className="font-bold text-white text-[9px] leading-none">m</span>
        </div>
        <span className="text-[10px] font-bold text-fg-5 tracking-widest uppercase">
          metid
        </span>
      </div>

      {/* Window controls — not part of the drag region */}
      <div className="flex items-center h-full">
        <button
          onClick={() => win.minimize()}
          tabIndex={-1}
          className="h-full w-11 flex items-center justify-center text-fg-4 hover:text-fg hover:bg-elevated transition-colors"
        >
          <Minus size={13} />
        </button>
        <button
          onClick={() => win.toggleMaximize()}
          tabIndex={-1}
          className="h-full w-11 flex items-center justify-center text-fg-4 hover:text-fg hover:bg-elevated transition-colors"
        >
          <Square size={11} />
        </button>
        <button
          onClick={() => win.close()}
          tabIndex={-1}
          className="h-full w-11 flex items-center justify-center text-fg-4 hover:text-white hover:bg-red-500 transition-colors"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  );
}
