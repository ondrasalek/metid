import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
  type Ref,
} from "react";
import { Search } from "lucide-react";
import type { CommonTag } from "../constants";

/* ───────────────────────────── Buttons ───────────────────────────── */

type ButtonVariant = "primary" | "secondary" | "ghost";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-blue-600 text-white shadow-sm hover:bg-blue-500 active:bg-blue-700 disabled:bg-elevated2 disabled:text-fg-5 disabled:shadow-none",
  secondary:
    "border border-line-strong bg-panel text-fg-2 shadow-sm hover:bg-elevated active:bg-elevated2 disabled:text-fg-5 disabled:shadow-none",
  ghost: "text-fg-3 hover:bg-ovl/[0.06] hover:text-fg active:bg-ovl/10 disabled:text-fg-5",
};

export function Button({
  variant = "secondary",
  icon,
  children,
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; icon?: ReactNode }) {
  return (
    <button
      {...rest}
      className={`inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 disabled:cursor-default ${VARIANTS[variant]} ${className}`}
    >
      {icon}
      {children}
    </button>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="font-sans text-[11px] tracking-wide text-fg-5">{children}</kbd>;
}

/* ───────────────────────────── Layout bits ───────────────────────────── */

// Unified toolbar: doubles as the window drag region (it sits under the
// overlay titlebar), with the title on the left and actions on the right.
export function Toolbar({
  title,
  subtitle,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header
      data-tauri-drag-region
      className="flex h-[52px] shrink-0 items-center justify-between gap-4 border-b border-line bg-panel px-4"
    >
      <div data-tauri-drag-region className="pointer-events-none min-w-0">
        <h1 className="truncate text-[13px] font-semibold leading-tight text-fg">{title}</h1>
        {subtitle && <p className="truncate text-[11px] leading-tight text-fg-4">{subtitle}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </header>
  );
}

export function StatusBar({ left, right }: { left?: ReactNode; right?: ReactNode }) {
  return (
    <footer className="flex h-6 shrink-0 items-center justify-between gap-4 border-t border-line bg-panel px-3 text-[11px] text-fg-4">
      <div className="flex min-w-0 items-center gap-3 truncate">{left}</div>
      <div className="flex shrink-0 items-center gap-3">{right}</div>
    </footer>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
      <div className="mb-4 text-fg-5">{icon}</div>
      <h2 className="mb-1 text-[15px] font-semibold text-fg">{title}</h2>
      <p className="mb-5 max-w-xs text-[13px] leading-relaxed text-fg-4">{description}</p>
      {action}
    </div>
  );
}

export function SearchField({
  value,
  onChange,
  placeholder,
  inputRef,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  inputRef?: Ref<HTMLInputElement>;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-4" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) {
            e.stopPropagation();
            onChange("");
          }
        }}
        placeholder={placeholder}
        spellCheck={false}
        className="h-7 w-full rounded-md border border-line-strong bg-app pl-8 pr-2 text-[13px] text-fg outline-none placeholder:text-fg-5 focus:border-blue-500/60 focus:ring-2 focus:ring-blue-500/20"
      />
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className = "",
}: {
  value: T;
  options: { value: T; label: string; icon?: ReactNode }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={`inline-flex gap-0.5 rounded-lg bg-elevated p-0.5 ${className}`} role="group">
      {options.map((o) => (
        <button
          key={o.value}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`inline-flex h-6 flex-1 items-center justify-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors ${
            value === o.value ? "bg-panel text-fg shadow-sm" : "text-fg-4 hover:text-fg"
          }`}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 ${
        checked ? "bg-blue-600" : "bg-elevated2"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-[18px]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

/* ───────────────────────────── Tag picker ───────────────────────────── */

export type TagPickerHandle = { open: () => void };

// One popover for every "pick a tag" flow (add tag, add batch column, add
// default column). Closes on outside click or Esc; arrow keys + Enter pick.
export function TagPicker({
  tags,
  onPick,
  renderTrigger,
  emptyText = "All common tags already added",
  align = "right",
  ref,
}: {
  tags: CommonTag[];
  onPick: (name: string) => void;
  renderTrigger: (props: { onClick: () => void; open: boolean }) => ReactNode;
  emptyText?: string;
  align?: "left" | "right";
  ref?: Ref<TagPickerHandle>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({ open: () => setOpen(true) }), []);

  function close() {
    setOpen(false);
    setQuery("");
    setCursor(0);
  }

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  const matches = useMemo(() => {
    const q = query.toLowerCase();
    return q
      ? tags.filter((t) => t.name.toLowerCase().includes(q) || t.hint.toLowerCase().includes(q))
      : tags;
  }, [tags, query]);

  function pick(name: string) {
    onPick(name);
    close();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter" && matches[cursor]) {
      e.preventDefault();
      pick(matches[cursor].name);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      {renderTrigger({ onClick: () => (open ? close() : setOpen(true)), open })}
      {open && (
        <div
          onKeyDown={onKeyDown}
          className={`animate-pop absolute top-full z-40 mt-1.5 w-64 overflow-hidden rounded-lg border border-line-strong bg-panel shadow-xl shadow-black/25 ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          <div className="border-b border-line p-1.5">
            <SearchField
              value={query}
              onChange={(v) => {
                setQuery(v);
                setCursor(0);
              }}
              placeholder="Search tags…"
              inputRef={(el) => el?.focus()}
            />
          </div>
          <ul className="custom-scrollbar max-h-64 overflow-y-auto p-1">
            {matches.length === 0 ? (
              <li className="px-3 py-5 text-center text-xs text-fg-4">{emptyText}</li>
            ) : (
              matches.map((t, i) => (
                <li key={t.name}>
                  <button
                    onClick={() => pick(t.name)}
                    onMouseMove={() => setCursor(i)}
                    className={`flex w-full flex-col rounded-md px-2.5 py-1.5 text-left ${
                      i === cursor ? "bg-blue-600 text-white" : "text-fg"
                    }`}
                  >
                    <span className="text-[13px] font-medium">{t.name}</span>
                    <span className={`text-[11px] ${i === cursor ? "text-white/75" : "text-fg-4"}`}>
                      {t.hint}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
