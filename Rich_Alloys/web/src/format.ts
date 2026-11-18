// Display only. Every stored number is calculated in the database views; these only print them.
const money = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const weight = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const perKg = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 3 });
type N = number | string | null | undefined;
const blank = (n: N) => n === null || n === undefined || n === "";

export const inr = (n: N) => (blank(n) ? "—" : `${Number(n) < 0 ? "−" : ""}₹${money.format(Math.abs(Number(n)))}`);
export const kg = (n: N) => (blank(n) ? "—" : `${weight.format(Number(n))} kg`);
export const rate = (n: N) => (blank(n) ? "—" : `₹${perKg.format(Number(n))}/kg`);
export const day = (iso: string | null | undefined) => (!iso ? "—"
  : new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }));
export const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
export const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** Parse what a person typed: "4,874.9" -> 4874.9, "" -> null, junk -> NaN. */
export function num(s: string): number | null {
  const t = s.replace(/[,\s₹]/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}
/** For filling a form field from a stored value. */
export const str = (n: N) => (blank(n) ? "" : String(n));
