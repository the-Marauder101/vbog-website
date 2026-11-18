// Every read and write the screens make goes through this file.
// Live mode talks to Supabase. Demo mode (no keys in .env) runs on in-memory sample data.
import { createClient } from "@supabase/supabase-js";
import { toLogin, type Deal, type Doc, type DocType, type Profile, type Role, type StaffAction, type StaffMember } from "./types";
import { demoApi } from "./demo";

export type DealDocsData = { types: DocType[]; docs: Doc[]; hasReturn: boolean };
export type DocAction = "verify_document" | "approve_document" | "reject_document";
export type NewDocument = { dealId: string; docType: string; path: string; userId: string; blob: Blob; name: string };

/** transient = worth retrying by itself (network, server busy); otherwise a person must act. */
export class UploadError extends Error {
  constructor(message: string, public transient: boolean) { super(message); }
}

export interface Api {
  demo: boolean;
  currentUser(): Promise<string | null>;
  onAuthChange(cb: (userId: string | null) => void): () => void;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  profile(userId: string): Promise<Profile | null>;
  setDemoRole?(role: Role): void;
  deals(): Promise<{ deals: Deal[]; gaps: Record<string, number> }>;
  dealDocs(dealId: string): Promise<DealDocsData>;
  /** Store one file, reporting progress 0..1. A file already at this path counts as stored. */
  putFile(path: string, blob: Blob, type: string, onProgress: (p: number) => void, signal: AbortSignal): Promise<void>;
  /** Write the document row for a stored file. A row already written for this path counts as done. */
  recordDocument(d: NewDocument): Promise<void>;
  fileUrl(doc: Doc): Promise<string>;
  act(action: DocAction, docId: string, note?: string): Promise<void>;
  staff(): Promise<StaffMember[]>;
  staffAction(body: StaffAction): Promise<void>;
}

// Keys come from config.js at run time (so a built copy can be configured without rebuilding),
// or from .env at build time.
const cfg = (window as unknown as { RA_CONFIG?: { supabaseUrl?: string; supabaseAnonKey?: string } }).RA_CONFIG ?? {};
const url = cfg.supabaseUrl || (import.meta.env.VITE_SUPABASE_URL as string | undefined);
const key = cfg.supabaseAnonKey || (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined);
const BUCKET = "deal-docs";

// Server refusals in words a person can act on (PRD 9: every error says what to do next).
function plainRefusal(status: number, msg: string): string {
  if (status === 413 || /too large|exceeded the maximum/i.test(msg)) return "File is larger than 20 MB. Take a smaller photo or split the PDF.";
  if (status === 415 || /mime|content type/i.test(msg)) return "Only photos and PDFs can be uploaded.";
  if (status === 403 || /row-level security|unauthori[sz]ed|permission/i.test(msg)) return "Your login is not allowed to upload. Ask the admin to check your role.";
  return `${msg}. Try again, or send this to V-BOG.`;
}

function liveApi(url: string, key: string): Api {
  const sb = createClient(url, key);
  const ok = <T,>(r: { data: T; error: { message: string } | null }): T => {
    if (r.error) throw new Error(r.error.message);
    return r.data;
  };
  return {
    demo: false,
    async currentUser() { return (await sb.auth.getSession()).data.session?.user.id ?? null; },
    onAuthChange(cb) {
      const { data } = sb.auth.onAuthStateChange((_e, s) => cb(s?.user.id ?? null));
      return () => data.subscription.unsubscribe();
    },
    async signIn(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email: toLogin(email), password });
      if (error) throw new Error(error.message);
    },
    async signOut() { await sb.auth.signOut(); },
    async profile(userId) {
      return ok(await sb.from("profiles").select("id, full_name, role").eq("id", userId).maybeSingle()) as Profile | null;
    },
    async deals() {
      const [d, g] = await Promise.all([
        sb.from("deals").select("id, deal_no, po_no, deal_date, status, suppliers(name)").order("deal_date", { ascending: false }),
        sb.from("v_doc_gaps").select("deal_no"),
      ]);
      const gaps: Record<string, number> = {};
      for (const row of ok(g) as { deal_no: string }[]) gaps[row.deal_no] = (gaps[row.deal_no] ?? 0) + 1;
      return { deals: ok(d) as unknown as Deal[], gaps };
    },
    async dealDocs(dealId) {
      const [ty, dc, rt] = await Promise.all([
        sb.from("doc_types").select("code, name, name_hi, side, required, sort").order("sort"),
        sb.from("documents").select("id, doc_type, storage_path, status, note, uploaded_at").eq("deal_id", dealId).order("uploaded_at"),
        sb.from("returns").select("id", { count: "exact", head: true }).eq("deal_id", dealId),
      ]);
      if (rt.error) throw new Error(rt.error.message);
      return { types: ok(ty) as DocType[], docs: ok(dc) as Doc[], hasReturn: (rt.count ?? 0) > 0 };
    },
    // Plain XHR rather than supabase-js: it is the only browser API that reports upload progress.
    async putFile(path, blob, type, onProgress, signal) {
      const token = (await sb.auth.getSession()).data.session?.access_token;
      if (!token) throw new UploadError("Signed out. Sign in again; the file is kept on this phone.", true);
      await new Promise<void>((resolve, reject) => {
        const x = new XMLHttpRequest();
        x.open("POST", `${url}/storage/v1/object/${BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`);
        x.setRequestHeader("Authorization", `Bearer ${token}`);
        x.setRequestHeader("apikey", key!);
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
    },
    async recordDocument(d) {
      const { error } = await sb.from("documents")
        .insert({ deal_id: d.dealId, doc_type: d.docType, storage_path: d.path, uploaded_by: d.userId });
      if (!error || error.code === "23505") return;      // 23505: this path is already recorded
      throw new UploadError(error.message, !error.code); // no code = never reached the database
    },
    async fileUrl(doc) {
      const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(doc.storage_path, 120);
      if (error) throw new Error(error.message);
      return data.signedUrl;
    },
    async act(action, docId, note) {
      const args = action === "reject_document" ? { p_id: docId, p_note: note ?? "" } : { p_id: docId };
      const { error } = await sb.rpc(action, args);
      if (error) throw new Error(error.message);
    },
    // Staff logins are managed by the staff-admin edge function, which holds the service key.
    async staff() {
      return (await callStaffAdmin({ action: "list" })).staff as StaffMember[];
    },
    async staffAction(body) { await callStaffAdmin(body); },
  };

  async function callStaffAdmin(body: object): Promise<Record<string, unknown>> {
    const { data, error } = await sb.functions.invoke("staff-admin", { body });
    if (error) {
      const ctx = (error as { context?: Response }).context;
      const msg = ctx && typeof ctx.json === "function" ? (await ctx.json().catch(() => null))?.error : null;
      throw new Error(msg || error.message);
    }
    return data as Record<string, unknown>;
  }
}

export const api: Api = url && key ? liveApi(url, key) : demoApi();
