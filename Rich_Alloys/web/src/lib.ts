// Shared plumbing: Supabase client, data loading, formatting, language, permissions, routing.
import { createClient } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

// Keys come from config.js at run time (a built copy can be configured without rebuilding), or .env at build time.
const cfg = ((window as unknown as { RA_CONFIG?: Record<string, string> }).RA_CONFIG) ?? {};
const URL_ = cfg.supabaseUrl || (import.meta.env.VITE_SUPABASE_URL as string | undefined) || "";
const KEY = cfg.supabaseAnonKey || (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || "";
export const configured = Boolean(URL_ && KEY);
export const SUPABASE_URL = URL_, SUPABASE_KEY = KEY;   // used by the upload queue for progress-reporting uploads
export const sb = createClient(URL_ || "http://localhost", KEY || "missing");
export const BUCKET = "deal-docs";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;

export async function q<T = Row[]>(p: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data as T;
}
export const rpc = <T = unknown,>(fn: string, args?: Row) => q<T>(sb.rpc(fn, args));

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    setError("");
    fn().then((d) => { if (live) setData(d); }).catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  const reload = useCallback(() => setN((x) => x + 1), []);
  return { data, error, reload };
}

// ---------- formatting ----------
const n3 = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const n2 = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const kg = (v: unknown) => (v == null || v === "" ? "—" : `${n3.format(Number(v))} kg`);
export const inr = (v: unknown) => (v == null || v === "" ? "—" : `${Number(v) < 0 ? "−" : ""}₹${n2.format(Math.abs(Number(v)))}`);
export function inrShort(v: number) {
  const a = Math.abs(v);
  const sg = v < 0 ? "−" : "";
  if (a >= 1e7) return `${sg}₹${(a / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `${sg}₹${(a / 1e5).toFixed(2)} L`;
  return `${sg}₹${Math.round(a).toLocaleString("en-IN")}`;
}
export function day(d: unknown) {
  if (!d) return "—";
  const s = String(d);
  const dt = new Date(s.length === 10 ? `${s}T00:00:00` : s);
  return dt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
export function today() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}
export function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}
export const toNum = (s: string) => (s.trim() === "" ? null : Number(s));
export const isNum = (s: string) => s.trim() !== "" && !Number.isNaN(Number(s));

// ---------- language ----------
export type Lang = "en" | "hi";
export const LangCtx = createContext<Lang>("en");
export function useT() {
  const lang = useContext(LangCtx);
  return (en: string, hi?: string) => (lang === "hi" && hi ? hi : en);
}
export function useLang() { return useContext(LangCtx); }
export const nm = (lang: Lang, r: Row | undefined | null, key = "name") =>
  !r ? "" : lang === "hi" && r[`${key}_hi`] ? r[`${key}_hi`] : r[key];

// ---------- who am I ----------
export type Me = { id: string; full_name: string; role: string; actions: Set<string> };
export const MeCtx = createContext<Me>({ id: "", full_name: "", role: "", actions: new Set() });
export function useMe() { return useContext(MeCtx); }
export function useCan() { const me = useMe(); return (a: string) => me.actions.has(a); }

// ---------- routing (hash, so the phone's back button works) ----------
export function useRoute(): string[] {
  const read = () => window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const [r, setR] = useState(read);
  useEffect(() => {
    const on = () => { setR(read()); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return r;
}
export const go = (path: string) => { window.location.hash = `/${path}`; };

// ---------- files ----------
export function download(name: string, text: string, type = "text/csv") {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export function csv(rows: Row[], cols: [string, string][]) {
  const esc = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.map((c) => esc(c[1])).join(","), ...rows.map((r) => cols.map((c) => esc(r[c[0]])).join(","))].join("\n");
}
export function printHtml(title: string, body: string) {
  const w = window.open("", "_blank");
  if (!w) { alert("Allow pop-ups to print."); return; }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>
    body{font:13px/1.4 system-ui,sans-serif;color:#111;margin:24px} h1{font-size:18px;margin:0 0 4px} h2{font-size:14px;margin:18px 0 6px}
    table{border-collapse:collapse;width:100%;margin:6px 0} th,td{border:1px solid #999;padding:4px 6px;text-align:left}
    td.n,th.n{text-align:right;font-variant-numeric:tabular-nums} .muted{color:#555} .box{display:flex;justify-content:space-between;gap:24px}
    @media print{button{display:none}}</style></head><body><button onclick="print()">Print</button>${body}</body></html>`);
  w.document.close();
}
export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

// ---------- photos: shrink before upload (factory data is slow) ----------
export async function shrinkImage(file: File, maxSide = 1800, quality = 0.8): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 1_500_000) return file;
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    const blob: Blob | null = await new Promise((res) => c.toBlob(res, "image/jpeg", quality));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch { return file; }
}

export const COMPANY = {
  name: "RICH ALLOYS INDIA PRIVATE LIMITED",
  address: "Plot No. 33/34/35, Aamgaon Industrial Estate, Talasari–Sanjan Road, Palghar, Maharashtra 401606",
  gstin: "27AAMCR8303C1ZF",
};

// ---------- logins ----------
// Staff without an email get a short login ID (e.g. "sanjay"). Supabase needs an email-shaped login,
// so the ID is stored as sanjay@<LOGIN_DOMAIN>. No mail is ever sent to it.
export const LOGIN_DOMAIN = "staff.richalloys.v-bog.com";
export function toLogin(input: string): string {
  const s = input.trim().toLowerCase();
  return s.includes("@") ? s : `${s}@${LOGIN_DOMAIN}`;
}
export const isLoginId = (s: string) => /^[a-z0-9][a-z0-9._-]{1,30}$/.test(s.trim().toLowerCase());
export const showLogin = (email: string | null | undefined) => (email ?? "").replace(`@${LOGIN_DOMAIN}`, "");

// ---------- dates (PRD 7a item 5: Tinu's sheets had dates typed into the wrong month or year) ----------
/** "future" if after today; "month" if not in the current month (unless futureOnly). */
export function dateWarning(iso: string, futureOnly = false): "future" | "month" | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const now = today();
  if (iso > now) return "future";
  if (!futureOnly && iso.slice(0, 7) !== now.slice(0, 7)) return "month";
  return null;
}

// ---------- GSTIN (PRD 7a item 6: suppliers keyed on GSTIN) ----------
export const normGstin = (s: string) => s.replace(/\s/g, "").toUpperCase();
/** Same shape the database checks: 2 digits (state), PAN (5 letters, 4 digits, 1 letter), entity, Z, check. */
export const gstinOk = (s: string) => /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(normGstin(s));
