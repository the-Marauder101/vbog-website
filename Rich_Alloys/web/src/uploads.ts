// Upload queue. PRD 9: "offline or slow upload: show progress, never lose a photo silently".
// - Photos are shrunk first (PRD 9: max 1,800 px JPEG), then saved on the phone (IndexedDB) before any network call, so a reload,
//   a closed tab or the browser killing the page while the camera is open does not lose it.
// - One file at a time (patchy network), with a progress bar per file.
// - Network trouble: the file waits and goes up by itself when the network is back.
// - Refused by the server (too big, wrong type, no permission): kept, reason shown, Retry or Remove.
// - Retries are safe: a file already stored or a document row already written counts as done.
import { useSyncExternalStore } from "react";
import { BUCKET, SUPABASE_KEY, SUPABASE_URL, sb, shrinkImage } from "./lib";

/** transient = worth retrying by itself (network, server busy); otherwise a person must act. */
export class UploadError extends Error {
  constructor(message: string, public transient: boolean) { super(message); }
}

// Server refusals in words a person can act on (PRD 9: errors say what to do next).
function plainRefusal(status: number, msg: string): string {
  if (status === 413 || /too large|exceeded the maximum/i.test(msg)) return "File is larger than 20 MB. Take a smaller photo or split the PDF.";
  if (status === 415 || /mime|content type/i.test(msg)) return "Only photos and PDFs can be uploaded.";
  if (status === 403 || /row-level security|unauthori[sz]ed|permission/i.test(msg)) return "Your login is not allowed to upload. Ask the admin to check your role.";
  return `${msg}. Try again, or send this to V-BOG.`;
}

/** Store one file with progress (plain XHR: the only browser API that reports upload progress).
 *  A file already at this path counts as stored. */
async function putFile(path: string, blob: Blob, type: string, onProgress: (p: number) => void, signal: AbortSignal) {
  const token = (await sb.auth.getSession()).data.session?.access_token;
  if (!token) throw new UploadError("Signed out. Sign in again; the file is kept on this phone.", true);
  await new Promise<void>((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("POST", `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`);
    x.setRequestHeader("Authorization", `Bearer ${token}`);
    x.setRequestHeader("apikey", SUPABASE_KEY);
    x.setRequestHeader("Content-Type", type || "application/octet-stream");
    x.setRequestHeader("x-upsert", "false");
    x.timeout = 15 * 60 * 1000;
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    x.onload = () => {
      if (x.status >= 200 && x.status < 300) return resolve();
      let body: { error?: string; message?: string; statusCode?: string } = {};
      try { body = JSON.parse(x.responseText); } catch { /* not JSON */ }
      const msg = body.message || body.error || `Upload refused (${x.status})`;
      if (x.status === 409 || body.statusCode === "409" || /duplicate|already exists/i.test(msg)) return resolve();
      const transient = x.status >= 500 || x.status === 429 || x.status === 401 || x.status === 408;
      reject(new UploadError(transient ? msg : plainRefusal(x.status, msg), transient));
    };
    x.onerror = () => reject(new UploadError("Network dropped", true));
    x.ontimeout = () => reject(new UploadError("Network too slow", true));
    x.onabort = () => reject(new UploadError("Network dropped", true));
    if (signal.aborted) return x.abort();
    signal.addEventListener("abort", () => x.abort(), { once: true });
    x.send(blob);
  });
}

/** Write the document row for a stored file. A row already written for this path counts as done. */
async function recordDocument(d: { dealId: string; docType: string; path: string; userId: string }) {
  const { error } = await sb.from("documents")
    .insert({ deal_id: d.dealId, doc_type: d.docType, storage_path: d.path, uploaded_by: d.userId });
  if (!error || error.code === "23505") return;      // 23505: this path is already recorded
  throw new UploadError(error.message, !error.code); // no code = never reached the database
}

export const MAX_BYTES = 20 * 1024 * 1024;   // matches the deal-docs bucket limit
const STALL_MS = 45_000;                       // no progress for this long = connection is dead
const BACKOFF = [3, 10, 30, 60];               // seconds between automatic retries

export type UpState = "uploading" | "waiting" | "failed";
export type UpItem = {
  id: string; userId: string; dealId: string; dealNo: string; docType: string;
  name: string; type: string; size: number; path: string; blob: Blob; addedAt: number;
  stage: "file" | "record";           // file = not yet in storage; record = stored, row not yet written
  state: UpState; progress: number; error?: string; attempts: number; retryAt?: number;
};

let items: UpItem[] = [];
let userId: string | null = null;
let running = false;
let current: AbortController | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
const doneListeners = new Set<(i: UpItem) => void>();

function emit() { items = [...items]; listeners.forEach((l) => l()); }
function patch(id: string, p: Partial<UpItem>) {
  items = items.map((i) => (i.id === id ? { ...i, ...p } : i));
  listeners.forEach((l) => l());
}
const get = (id: string) => items.find((i) => i.id === id);

export function useUploads(): UpItem[] {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => items);
}
export function onUploaded(fn: (i: UpItem) => void) { doneListeners.add(fn); return () => { doneListeners.delete(fn); }; }
export const online = () => (typeof navigator === "undefined" ? true : navigator.onLine !== false);

// ---------- phone storage (IndexedDB). Every call is guarded: private mode may refuse it. ----------
const DB = "ra-uploads", STORE = "queue";
function idb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}
async function idbDo(fn: (s: IDBObjectStore) => IDBRequest | void): Promise<unknown> {
  const db = await idb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      const r = fn(tx.objectStore(STORE));
      tx.oncomplete = () => { resolve(r ? r.result : null); db.close(); };
      tx.onerror = tx.onabort = () => { resolve(null); db.close(); };
    } catch { resolve(null); db.close(); }
  });
}
const save = (i: UpItem) => {
  const { progress: _p, retryAt: _r, ...keep } = i;
  return idbDo((s) => s.put({ ...keep, state: i.state === "failed" ? "failed" : "waiting", progress: 0 }));
};
const forget = (id: string) => idbDo((s) => s.delete(id));

// ---------- public actions ----------
export type Refused = { name: string; reason: "tooBig" | "badType" };

function guessType(f: File) {
  if (f.type) return f.type;
  const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
  return ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", heic: "image/heic", webp: "image/webp", pdf: "application/pdf" } as Record<string, string>)[ext] ?? "";
}

/** Queue files for one checklist item. Returns the files refused on the spot (never queued). */
export async function enqueue(deal: { id: string; deal_no: string }, docType: string, files: File[], uid: string): Promise<Refused[]> {
  const refused: Refused[] = [];
  for (const f0 of files) {
    const f = await shrinkImage(f0);
    const type = guessType(f);
    if (!(type.startsWith("image/") || type === "application/pdf")) { refused.push({ name: f.name, reason: "badType" }); continue; }
    if (f.size > MAX_BYTES) { refused.push({ name: f.name, reason: "tooBig" }); continue; }
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const safe = f.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const item: UpItem = {
      id, userId: uid, dealId: deal.id, dealNo: deal.deal_no, docType, name: f.name, type, size: f.size,
      path: `${deal.deal_no}/${docType}/${Date.now()}-${safe}`, blob: f, addedAt: Date.now(),
      stage: "file", state: "waiting", progress: 0, attempts: 0,
    };
    items = [...items, item];
    await save(item);
  }
  emit();
  pump();
  return refused;
}

export function retry(id: string) {
  const i = get(id);
  if (!i || i.state === "uploading") return;
  patch(id, { state: "waiting", error: undefined, retryAt: undefined, attempts: 0 });
  pump();
}

export async function remove(id: string) {
  if (get(id)?.state === "uploading") current?.abort();
  items = items.filter((i) => i.id !== id);
  emit();
  await forget(id);
}

/** After sign-in: load anything this person left waiting on this phone, and start. */
export async function resume(uid: string) {
  userId = uid;
  const saved = ((await idbDo((s) => s.getAll())) as UpItem[] | null) ?? [];
  const known = new Set(items.map((i) => i.id));
  const mine = saved.filter((i) => i.userId === uid && !known.has(i.id))
    .map((i) => ({ ...i, progress: 0, retryAt: undefined, state: i.state === "failed" ? "failed" : "waiting" } as UpItem));
  items = [...items.filter((i) => i.userId === uid), ...mine].sort((a, b) => a.addedAt - b.addedAt);
  emit();
  pump();
}

/** On sign-out: stop and clear the screen. Files stay saved on the phone for the next sign-in. */
export function pause() {
  userId = null;
  current?.abort();
  if (timer) clearTimeout(timer);
  items = [];
  emit();
}

// ---------- the worker ----------
function schedule(ms: number) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; pump(); }, ms);
}

async function pump() {
  if (running || !userId) return;
  running = true;
  try {
    for (;;) {
      if (!online() || !userId) break;
      const now = Date.now();
      const next = items.find((i) => i.state === "waiting" && (!i.retryAt || i.retryAt <= now));
      if (!next) {
        const soonest = items.filter((i) => i.state === "waiting" && i.retryAt).map((i) => i.retryAt!);
        if (soonest.length) schedule(Math.max(500, Math.min(...soonest) - now));
        break;
      }
      await attempt(next);
    }
  } finally { running = false; }
}

async function attempt(i: UpItem) {
  patch(i.id, { state: "uploading", progress: i.stage === "record" ? 1 : 0, error: undefined });
  const ctrl = new AbortController();
  current = ctrl;
  let stall: ReturnType<typeof setTimeout> | null = null;
  const kick = () => { if (stall) clearTimeout(stall); stall = setTimeout(() => ctrl.abort(), STALL_MS); };
  try {
    if (i.stage === "file") {
      kick();
      await putFile(i.path, i.blob, i.type, (p) => { kick(); patch(i.id, { progress: p }); }, ctrl.signal);
      if (stall) clearTimeout(stall);
      if (!get(i.id)) return;                                  // removed while uploading
      patch(i.id, { stage: "record", progress: 1 });
      await save(get(i.id)!);
    }
    await recordDocument({ dealId: i.dealId, docType: i.docType, path: i.path, userId: i.userId });
    items = items.filter((x) => x.id !== i.id);
    emit();
    await forget(i.id);
    doneListeners.forEach((l) => l(i));
  } catch (e) {
    if (stall) clearTimeout(stall);
    if (!get(i.id)) return;
    const transient = e instanceof UploadError ? e.transient : true;
    const attempts = (get(i.id)?.attempts ?? 0) + 1;
    if (transient) {
      const wait = BACKOFF[Math.min(attempts - 1, BACKOFF.length - 1)] * 1000;
      patch(i.id, { state: "waiting", attempts, retryAt: Date.now() + wait, progress: 0, error: (e as Error).message });
    } else {
      patch(i.id, { state: "failed", attempts, progress: 0, error: (e as Error).message });
      await save(get(i.id)!);
    }
  } finally {
    if (current === ctrl) current = null;
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    items.forEach((i) => { if (i.state === "waiting") i.retryAt = undefined; });
    emit();
    pump();
  });
  window.addEventListener("offline", () => { current?.abort(); emit(); });
  // Warn before leaving while files are not yet up. They are saved on the phone either way.
  window.addEventListener("beforeunload", (e) => {
    if (items.some((i) => i.state !== "failed")) { e.preventDefault(); e.returnValue = ""; }
  });
}
