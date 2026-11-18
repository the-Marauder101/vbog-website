// Staff management for the Rich Alloys portal. The only code that holds the service key.
// Called by the app's Staff screen with the signed-in person's token. Every action first
// checks that the caller is an active owner or vbog_admin, then uses Supabase's admin API.
// Deploy: supabase functions deploy staff-admin --project-ref <ref> --no-verify-jwt
// (the function checks the token itself; see `caller` below).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

// Must match can_manage_staff() in migrations/0005_staff.sql and canManageStaff in web/src/types.ts.
const MANAGERS = ["owner", "vbog_admin"];
const ROLES = ["owner", "deal_desk", "gate", "factory", "factory_accounts", "ho_accounts", "vbog_admin"];
const MIN_PASSWORD = 8;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
class Refuse extends Error { constructor(msg: string, public status = 400) { super(msg); } }

const URL_ = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function caller(req: Request) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) throw new Refuse("Not signed in", 401);
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new Refuse("Not signed in", 401);
  const { data: p } = await admin.from("profiles").select("id, role, active").eq("id", data.user.id).maybeSingle();
  if (!p?.active || !MANAGERS.includes(p.role)) throw new Refuse("Your role cannot manage staff", 403);
  return p.id as string;
}

const audit = (actor: string, rowId: string, action: string, detail: Record<string, unknown> = {}) =>
  admin.from("audit_log").insert({ actor, table_name: "profiles", row_id: rowId, action, detail });

function checkPassword(pw: unknown): string {
  if (typeof pw !== "string" || pw.length < MIN_PASSWORD) throw new Refuse(`Password must be at least ${MIN_PASSWORD} characters`);
  return pw;
}
function checkRole(r: unknown): string {
  if (typeof r !== "string" || !ROLES.includes(r)) throw new Refuse("Unknown role");
  return r;
}
const ok = <T,>(r: { data: T; error: { message: string } | null }): T => {
  if (r.error) throw new Refuse(r.error.message);
  return r.data;
};

async function list() {
  const profiles = ok(await admin.from("profiles")
    .select("id, email, full_name, role, active, created_at").order("full_name")) as Record<string, unknown>[];
  const users = new Map<string, string | null>();
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Refuse(error.message);
    for (const u of data.users) users.set(u.id, u.last_sign_in_at ?? null);
    if (data.users.length < 1000) break;
  }
  return profiles.map((p) => ({ ...p, last_sign_in_at: users.get(p.id as string) ?? null }));
}

async function create(me: string, b: Record<string, unknown>) {
  const email = String(b.email ?? "").trim().toLowerCase();
  const full_name = String(b.full_name ?? "").trim();
  if (!full_name) throw new Refuse("Name is required");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Refuse("Login must be an email address");
  const role = checkRole(b.role);
  const password = checkPassword(b.password);
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { full_name },
  });
  if (error) throw new Refuse(/already/i.test(error.message) ? "This login already exists" : error.message);
  const id = data.user.id;
  const plant = ok(await admin.from("plants").select("id").eq("name", "Palghar").maybeSingle()) as { id: string } | null;
  const ins = await admin.from("profiles").insert({ id, email, full_name, role, plant_id: plant?.id ?? null });
  if (ins.error) { await admin.auth.admin.deleteUser(id); throw new Refuse(ins.error.message); }
  await audit(me, id, "staff_created", { email, role });
  return { id };
}

async function update(me: string, b: Record<string, unknown>) {
  const id = String(b.id ?? "");
  const patch: Record<string, unknown> = {};
  if (b.full_name !== undefined) {
    const n = String(b.full_name).trim();
    if (!n) throw new Refuse("Name is required");
    patch.full_name = n;
  }
  if (b.role !== undefined) {
    patch.role = checkRole(b.role);
    if (id === me && !MANAGERS.includes(patch.role as string)) throw new Refuse("You cannot remove your own admin access");
  }
  ok(await admin.from("profiles").update(patch).eq("id", id));
  await audit(me, id, "staff_updated", patch);
  return {};
}

async function resetPassword(me: string, b: Record<string, unknown>) {
  const id = String(b.id ?? "");
  const password = checkPassword(b.password);
  const { error } = await admin.auth.admin.updateUserById(id, { password });
  if (error) throw new Refuse(error.message);
  await audit(me, id, "password_reset");
  return {};
}

async function setActive(me: string, b: Record<string, unknown>) {
  const id = String(b.id ?? "");
  const active = b.active === true;
  if (id === me && !active) throw new Refuse("You cannot switch off your own login");
  // Ban stops new sign-ins and token refresh; profiles.active stops reads straight away.
  const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: active ? "none" : "876000h" });
  if (error) throw new Refuse(error.message);
  ok(await admin.from("profiles").update({ active }).eq("id", id));
  await audit(me, id, active ? "staff_reactivated" : "staff_deactivated");
  return {};
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "Use POST" }, 405);
  try {
    const me = await caller(req);
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    switch (b.action) {
      case "list": return reply({ staff: await list() });
      case "create": return reply(await create(me, b));
      case "update": return reply(await update(me, b));
      case "reset_password": return reply(await resetPassword(me, b));
      case "set_active": return reply(await setActive(me, b));
      default: throw new Refuse("Unknown action");
    }
  } catch (e) {
    const status = e instanceof Refuse ? e.status : 500;
    return reply({ error: (e as Error).message }, status);
  }
});
