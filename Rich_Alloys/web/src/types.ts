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
// Must match can_manage_staff() in 0005_staff.sql and MANAGERS in supabase/functions/staff-admin.
export const canManageStaff = (r: Role) => ["owner", "vbog_admin"].includes(r);
export const ROLES: Role[] = ["gate", "factory", "factory_accounts", "ho_accounts", "deal_desk", "owner", "vbog_admin"];

export type StaffMember = {
  id: string; email: string | null; full_name: string; role: Role; active: boolean;
  created_at: string; last_sign_in_at: string | null;
};
export type StaffAction =
  | { action: "create"; email: string; full_name: string; role: Role; password: string }
  | { action: "update"; id: string; role: Role }
  | { action: "reset_password"; id: string; password: string }
  | { action: "set_active"; id: string; active: boolean };

// Staff without an email get a short login ID (e.g. "sanjay"). Supabase needs an email-shaped
// login, so the ID is stored as sanjay@<LOGIN_DOMAIN>. No mail is ever sent to it.
export const LOGIN_DOMAIN = "staff.richalloys.v-bog.com";
export function toLogin(input: string): string {
  const s = input.trim().toLowerCase();
  return s.includes("@") ? s : `${s}@${LOGIN_DOMAIN}`;
}
export const isLoginId = (s: string) => /^[a-z0-9][a-z0-9._-]{1,30}$/.test(s.trim().toLowerCase());
export const showLogin = (email: string | null) => (email ?? "").replace(`@${LOGIN_DOMAIN}`, "");
