// Every read and write the screens make goes through this file.
// Live mode talks to Supabase. Demo mode (no keys in .env) runs on in-memory sample data.
import { createClient } from "@supabase/supabase-js";
import type { Deal, Doc, DocType, Profile, Role } from "./types";
import { demoApi } from "./demo";

export type DealDocsData = { types: DocType[]; docs: Doc[]; hasReturn: boolean };
export type DocAction = "verify_document" | "approve_document" | "reject_document";

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
  upload(deal: Deal, docType: string, file: File, userId: string): Promise<void>;
  fileUrl(doc: Doc): Promise<string>;
  act(action: DocAction, docId: string, note?: string): Promise<void>;
}

// Keys come from config.js at run time (so a built copy can be configured without rebuilding),
// or from .env at build time.
const cfg = (window as unknown as { RA_CONFIG?: { supabaseUrl?: string; supabaseAnonKey?: string } }).RA_CONFIG ?? {};
const url = cfg.supabaseUrl || (import.meta.env.VITE_SUPABASE_URL as string | undefined);
const key = cfg.supabaseAnonKey || (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined);
const BUCKET = "deal-docs";

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
      const { error } = await sb.auth.signInWithPassword({ email, password });
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
    async upload(deal, docType, file, userId) {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${deal.deal_no}/${docType}/${Date.now()}-${safe}`;
      const up = await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type });
      if (up.error) throw new Error(up.error.message);
      ok(await sb.from("documents").insert({ deal_id: deal.id, doc_type: docType, storage_path: path, uploaded_by: userId }));
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
  };
}

export const api: Api = url && key ? liveApi(url, key) : demoApi();
