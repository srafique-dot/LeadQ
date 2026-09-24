import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import styles from "./SearchableSelect.module.css";

export interface SearchableSelectOption {
  value: string;
  label: string;
}

interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  /** Applied to the trigger button, so it can be dropped in wherever a
   * `<select className={styles.textInput}>` used to sit and keep the same
   * border/padding/font the rest of the form uses. */
  triggerClassName?: string;
  triggerStyle?: CSSProperties;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Overrides the little arrow's color — needed on a dark trigger
   * (the superadmin nav bar), where the default muted-grey reads as
   * near-invisible. */
  chevronColor?: string;
  "aria-label"?: string;
}

/** A type-to-search replacement for a plain `<select>`. Long option lists
 * (14 lead types, every active agent, every account) meant scrolling a
 * native dropdown to find one; this opens a small search box instead.
 *
 * Rendered as a portal into document.body and positioned from the
 * trigger's own bounding box, because most call sites live inside a
 * scrolling modal — an absolutely-positioned panel would get clipped or
 * scroll away with the form instead of floating above it. Closes on
 * scroll/resize rather than re-tracking position, which is simpler and
 * matches how a native select's popup behaves (it also disappears if the
 * page moves under it). */
export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "Choose one…",
  triggerClassName,
  triggerStyle,
  disabled,
  autoFocus,
  chevronColor,
  ...aria
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value);
  const filtered = query.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  function openPanel() {
    if (disabled) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const estimatedHeight = Math.min(320, filtered.length * 38 + 56);
    const spaceBelow = window.innerHeight - rect.bottom;
    const openAbove = spaceBelow < estimatedHeight && rect.top > spaceBelow;
    // Widened a bit past the trigger for labels longer than it (e.g. "Name ·
    // EMPLOYEE_ID · Role"), then clamped so a trigger sitting near the right
    // edge (the nav bar's "View as") doesn't push the panel off-screen.
    const width = Math.max(rect.width, 260);
    const left = Math.min(rect.left, window.innerWidth - width - 8);
    setPos({
      left: Math.max(8, left),
      width,
      top: openAbove ? Math.max(8, rect.top - estimatedHeight - 4) : rect.bottom + 4,
      maxHeight: openAbove ? Math.min(estimatedHeight, rect.top - 12) : Math.min(estimatedHeight, window.innerHeight - rect.bottom - 12),
    });
    setQuery("");
    setHighlighted(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  }

  useLayoutEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    // Capture-phase "scroll" fires for a scroll anywhere in the document,
    // including inside the option list itself — without this check, the
    // very act of scrolling the list closed it before any movement showed.
    // Only a scroll outside the panel (the page moving under it) should
    // close it.
    function onScrollOrResize(e: Event) {
      if (e.target instanceof Node && panelRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open]);

  function choose(opt: SearchableSelectOption) {
    onChange(opt.value);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function onSearchKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(filtered.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[highlighted]) choose(filtered[highlighted]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }
  }

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className={`${styles.trigger} ${triggerClassName ?? ""}`}
        style={triggerStyle}
        disabled={disabled}
        autoFocus={autoFocus}
        onClick={() => (open ? setOpen(false) : openPanel())}
        {...aria}
      >
        <span className={`${styles.triggerLabel} ${selected ? "" : styles.placeholder}`}>{selected?.label ?? placeholder}</span>
        <span className={styles.chevron} style={chevronColor ? { borderColor: chevronColor } : undefined} aria-hidden="true" />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            className={styles.panel}
            style={{ top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxHeight }}
          >
            <div className={styles.searchBox}>
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setHighlighted(0);
                }}
                onKeyDown={onSearchKeyDown}
                placeholder="Type to search…"
                className={styles.searchInput}
              />
            </div>
            <div className={styles.list}>
              {filtered.length === 0 ? (
                <div className={styles.empty}>No matches.</div>
              ) : (
                filtered.map((o, i) => (
                  <button
                    key={o.value}
                    type="button"
                    className={`${styles.option} ${i === highlighted ? styles.active : ""}`}
                    onMouseEnter={() => setHighlighted(i)}
                    onClick={() => choose(o)}
                  >
                    {o.label}
                  </button>
                ))
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
