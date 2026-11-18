// Small form and layout pieces shared by the deal, payables, Tally and admin screens.
import { useCallback, useEffect, useState, type ReactNode } from "react";

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reload = useCallback(() => fn().then((d) => { setData(d); setError(""); }).catch((e: Error) => setError(e.message)), deps);
  useEffect(() => { reload(); }, [reload]);
  return { data, error, reload };
}

type FieldProps = { label: string; value: string; onChange: (v: string) => void; disabled?: boolean; required?: boolean; hint?: string };

export function NumIn({ label, value, onChange, disabled, required, hint, suffix }: FieldProps & { suffix?: string }) {
  return (
    <label className="fld">
      <span>{label}</span>
      <span className="numwrap">
        <input inputMode="decimal" value={value} disabled={disabled} required={required}
               onChange={(e) => onChange(e.target.value)} autoComplete="off" />
        {suffix && <span className="suffix">{suffix}</span>}
      </span>
      {hint && <span className="muted small hint">{hint}</span>}
    </label>
  );
}

export function TxtIn({ label, value, onChange, disabled, required, hint, upper }: FieldProps & { upper?: boolean }) {
  return (
    <label className="fld">
      <span>{label}</span>
      <input value={value} disabled={disabled} required={required} autoComplete="off"
             onChange={(e) => onChange(upper ? e.target.value.toUpperCase() : e.target.value)} />
      {hint && <span className="muted small hint">{hint}</span>}
    </label>
  );
}

export function DateIn({ label, value, onChange, disabled, required }: FieldProps) {
  return (
    <label className="fld">
      <span>{label}</span>
      <input type="date" value={value} disabled={disabled} required={required} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export function Sel({ label, value, onChange, disabled, options }: Omit<FieldProps, "required" | "hint"> & { options: [string, string][] }) {
  return (
    <label className="fld">
      <span>{label}</span>
      <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

export function Check({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

/** A label and a value on one line; tone colours the value. */
export function KV({ k, v, tone, strong }: { k: ReactNode; v: ReactNode; tone?: "ok" | "bad" | "wait"; strong?: boolean }) {
  return <div className={`kv ${tone ?? ""} ${strong ? "strong" : ""}`}><span>{k}</span><span className="num">{v}</span></div>;
}

export const Err = ({ msg }: { msg: string }) => (msg ? <p className="error" role="alert">{msg}</p> : null);
export const Ok = ({ msg }: { msg: string }) => (msg ? <p className="okline" role="status">✓ {msg}</p> : null);

/** Run a save: busy flag, error text, success text. */
export function useSaver() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  useEffect(() => { if (!done) return; const h = setTimeout(() => setDone(""), 4000); return () => clearTimeout(h); }, [done]);
  async function run(work: () => Promise<unknown>, okText = "") {
    setBusy(true); setError(""); setDone("");
    try { await work(); setDone(okText); return true; }
    catch (e) { setError((e as Error).message); return false; }
    finally { setBusy(false); }
  }
  return { busy, error, done, run, setError };
}
