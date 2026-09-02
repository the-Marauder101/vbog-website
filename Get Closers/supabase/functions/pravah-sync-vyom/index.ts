import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const authorization = request.headers.get("Authorization");
    if (!authorization) return json({ error: "Authentication required." }, 401);

    const pravahUrl = required("SUPABASE_URL");
    const pravahAnon = required("SUPABASE_ANON_KEY");
    const pravahService = required("SUPABASE_SERVICE_ROLE_KEY");
    const vyomUrl = required("VYOM_SUPABASE_URL");
    const vyomService = required("VYOM_SERVICE_ROLE_KEY");

    const caller = createClient(pravahUrl, pravahAnon, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const { data: context, error: contextError } = await caller.rpc("pravah_context");
    if (contextError || !context?.authorized || !context?.is_internal) {
      return json({ error: "Pravah staff access required." }, 403);
    }

    const vyom = createClient(vyomUrl, vyomService, { auth: { persistSession: false } });
    const { data: clients, error: vyomError } = await vyom
      .from("client_overview")
      .select("id,name,active,owner_id,owner_name,contact_name,contact_email,rate,notes,created_at")
      .order("name");
    if (vyomError) throw vyomError;

    const rows = (clients || []).map((client) => ({
      source_system: "vyom",
      source_client_id: client.id,
      source_name: client.name,
      source_name_normalized: normalize(client.name),
      source_active: client.active,
      source_payload: client,
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

    const admin = createClient(pravahUrl, pravahService, { auth: { persistSession: false } });
    if (rows.length) {
      const { error } = await admin.from("pravah_client_sync_inbox").upsert(rows, {
        onConflict: "source_system,source_client_id",
        ignoreDuplicates: false,
      });
      if (error) throw error;
    }

    return json({ ok: true, received: rows.length, refreshed_at: new Date().toISOString() });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Sync failed." }, 500);
  }
});

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function normalize(value: string): string {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
