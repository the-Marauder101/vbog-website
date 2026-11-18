export type Role = "owner" | "deal_desk" | "gate" | "factory" | "factory_accounts" | "ho_accounts" | "vbog_admin";
export type Profile = { id: string; full_name: string; role: Role };
export type DocStatus = "uploaded" | "verified" | "approved" | "rejected";
export type Side = "supplier" | "rich_alloys" | "return";
export type DocType = { code: string; name: string; name_hi: string | null; side: Side; required: boolean; sort: number };
export type Doc = {
  id: string; doc_type: string; storage_path: string; status: DocStatus; note: string | null; uploaded_at: string;
};
export type Deal = {
  id: string; deal_no: string; po_no: string | null; deal_date: string; status: string;
  suppliers: { name: string } | null;
};

// Must match the role lists in supabase/migrations/0003_access.sql. The database enforces them;
// these only decide which buttons to show.
export const canVerify = (r: Role) => ["factory_accounts", "ho_accounts", "owner", "vbog_admin"].includes(r);
export const canApprove = (r: Role) => ["ho_accounts", "owner", "vbog_admin"].includes(r);
