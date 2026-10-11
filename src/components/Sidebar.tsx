import type { ReactNode } from "react";
import { FileText, Settings, Table2 } from "lucide-react";
import { MOD_LABEL } from "../hooks/useHotkeys";
import type { Mode } from "../App";

function NavItem({
  active,
  icon,
  label,
  shortcut,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  shortcut: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`group flex h-7 w-full items-center gap-2 rounded-md px-2 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 ${
        active ? "bg-ovl/[0.1] font-medium text-fg" : "text-fg-2 hover:bg-ovl/[0.05]"
      }`}
    >
      <span className={active ? "text-blue-500" : "text-fg-3"}>{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      <span className="text-[11px] text-fg-5 opacity-0 transition-opacity group-hover:opacity-100">
        {shortcut}
      </span>
    </button>
  );
}

// Source-list sidebar. Sits on the native vibrancy material in the real app;
// the top strip is a drag region that also clears the overlay traffic lights.
export function Sidebar({ mode, onSwitch }: { mode: Mode; onSwitch: (m: Mode) => void }) {
  return (
    <aside className="sidebar-surface flex w-[210px] shrink-0 flex-col border-r border-ovl/[0.08]">
      <div data-tauri-drag-region className="h-[52px] shrink-0" />

      <nav className="flex-1 space-y-0.5 px-2.5">
        <p className="px-2 pb-1 pt-1 text-[11px] font-semibold text-fg-4">Editor</p>
        <NavItem
          active={mode === "single"}
          icon={<FileText size={15} />}
          label="Single File"
          shortcut={`${MOD_LABEL}1`}
          onClick={() => onSwitch("single")}
        />
        <NavItem
          active={mode === "batch"}
          icon={<Table2 size={15} />}
          label="Batch Edit"
          shortcut={`${MOD_LABEL}2`}
          onClick={() => onSwitch("batch")}
        />
      </nav>

      <div className="space-y-0.5 px-2.5 pb-3">
        <NavItem
          active={mode === "settings"}
          icon={<Settings size={15} />}
          label="Settings"
          shortcut={`${MOD_LABEL},`}
          onClick={() => onSwitch("settings")}
        />
      </div>
    </aside>
  );
}
