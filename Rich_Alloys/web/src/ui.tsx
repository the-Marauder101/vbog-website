// Small set of building blocks. Big targets, few choices, words plus colour for every status.
import { isValidElement, useEffect, type ReactNode } from "react";
import { dateWarning, useT } from "./lib";

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: "primary" | "danger" | "ghost" | ""; small?: boolean };
export function Btn({ kind = "", small, className = "", ...p }: BtnProps) {
  return <button type="button" className={`btn ${kind} ${small ? "small" : ""} ${className}`} {...p} />;
}

export function Field({ label, hint, children, wide }: { label: string; hint?: ReactNode; children: ReactNode; wide?: boolean }) {
  // a group of option buttons must not sit inside <label> (the first button would take the whole label as its name)
  if (isValidElement(children) && children.type === Choice) {
    return (
      <div className={`field ${wide ? "wide" : ""}`} role="group" aria-label={label}>
        <span className="label">{label}</span>{children}{hint && <span className="hint">{hint}</span>}
      </div>
    );
  }
  return (
    <label className={`field ${wide ? "wide" : ""}`}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function NumIn({ value, onChange, suffix, placeholder, autoFocus }: {
  value: string; onChange: (v: string) => void; suffix?: string; placeholder?: string; autoFocus?: boolean;
}) {
  return (
    <span className="num">
      <input inputMode="decimal" value={value} placeholder={placeholder} autoFocus={autoFocus}
             onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))} />
      {suffix && <span className="suffix" aria-hidden="true">{suffix}</span>}
    </span>
  );
}

export function TextIn(p: React.InputHTMLAttributes<HTMLInputElement> & { onValue: (v: string) => void }) {
  const { onValue, ...rest } = p;
  return <input {...rest} onChange={(e) => onValue(e.target.value)} />;
}

export function Select({ value, onChange, options, placeholder }: {
  value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder?: string;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Choice({ value, onChange, options, cols }: {
  value: string; onChange: (v: string) => void; options: { value: string; label: string; sub?: string }[]; cols?: number;
}) {
  return (
    <div className="choice" style={cols ? { gridTemplateColumns: `repeat(${cols}, 1fr)` } : undefined} role="radiogroup">
      {options.map((o) => (
        <button type="button" key={o.value} role="radio" aria-checked={value === o.value}
                className={value === o.value ? "on" : ""} onClick={() => onChange(o.value)}>
          <span>{o.label}</span>{o.sub && <small>{o.sub}</small>}
        </button>
      ))}
    </div>
  );
}

export function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const t = useT();
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", on);
    document.body.classList.add("locked");
    return () => { document.removeEventListener("keydown", on); document.body.classList.remove("locked"); };
  }, [onClose]);
  return (
    <div className="sheet-wrap" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <header><h2>{title}</h2><button type="button" className="x" onClick={onClose} aria-label={t("Close", "बंद करें")}>×</button></header>
        <div className="sheet-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

export type Tone = "ok" | "wait" | "bad" | "none" | "info";
export function Chip({ tone = "none", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`chip ${tone}`}>{children}</span>;
}

export function Section({ title, right, children }: { title: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="section">
      <div className="section-head"><h2>{title}</h2>{right}</div>
      {children}
    </section>
  );
}

export function Loading() { const t = useT(); return <p className="muted pad">{t("Loading…", "लोड हो रहा है…")}</p>; }
export function Err({ error }: { error: string }) { return error ? <p className="error" role="alert">{error}</p> : null; }
export function Empty({ children }: { children: ReactNode }) { return <p className="empty">{children}</p>; }

export function Tabs({ tabs, value, onChange }: { tabs: { id: string; label: string; badge?: number }[]; value: string; onChange: (id: string) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((x) => (
        <button type="button" key={x.id} role="tab" aria-selected={value === x.id} className={value === x.id ? "on" : ""} onClick={() => onChange(x.id)}>
          {x.label}{x.badge ? <span className="badge">{x.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function KV({ rows }: { rows: [ReactNode, ReactNode, string?][] }) {
  return (
    <dl className="kv">
      {rows.map(([k, v, cls], i) => <div key={i} className={cls}><dt>{k}</dt><dd>{v}</dd></div>)}
    </dl>
  );
}

// "Saving…" wrapper used by every form footer
export function SaveBar({ busy, error, onSave, label, disabled }: { busy: boolean; error: string; onSave: () => void; label: string; disabled?: boolean }) {
  const t = useT();
  return (
    <>
      <Err error={error} />
      <Btn kind="primary" className="block" disabled={busy || disabled} onClick={onSave}>{busy ? t("Saving…", "सेव हो रहा है…") : label}</Btn>
    </>
  );
}

/** A date that happened. Warns (does not block) when it is in the future or outside the current month. */
export function DateIn({ value, onChange, futureOnly }: { value: string; onChange: (v: string) => void; futureOnly?: boolean }) {
  const t = useT();
  const w = dateWarning(value, futureOnly);
  return (
    <>
      <input type="date" value={value} onChange={(e) => onChange(e.target.value)} />
      {w && <span className="date-warn" role="status">{w === "future"
        ? t("This date is in the future. Check it.", "यह तारीख आगे की है। जाँच लें।")
        : t("This date is not in the current month. Check it.", "यह तारीख इस महीने की नहीं है। जाँच लें।")}</span>}
    </>
  );
}
