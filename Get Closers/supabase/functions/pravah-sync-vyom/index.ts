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

    const { data: handoffs, error: handoffError } = await vyom
      .from("pravah_candidate_handoff")
      .select("source_task_id,source_project_id,candidate_name,candidate_email,source_client_id,source_client_name,source_status,status_changed_at,updated_at,source_payload")
      .order("status_changed_at", { ascending: false });
    if (handoffError) throw handoffError;

    const candidateRows = (handoffs || []).map((candidate) => ({
      source_system: "vyom",
      source_task_id: candidate.source_task_id,
      source_project_id: candidate.source_project_id,
      source_name: candidate.candidate_name,
      source_name_normalized: normalize(candidate.candidate_name),
      source_email: candidate.candidate_email,
      source_client_id: candidate.source_client_id,
      source_client_name: candidate.source_client_name,
      source_status: candidate.source_status,
      source_payload: candidate.source_payload || {},
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));
    if (candidateRows.length) {
      const { error } = await admin.from("pravah_candidate_sync_inbox").upsert(candidateRows, {
        onConflict: "source_system,source_task_id",
        ignoreDuplicates: false,
      });
      if (error) throw error;
    }

    const milestoneResult = await deliverMilestones(admin, vyom);
    return json({
      ok: true,
      clients_received: rows.length,
      candidates_received: candidateRows.length,
      milestones_delivered: milestoneResult.delivered,
      milestones_failed: milestoneResult.failed,
      refreshed_at: new Date().toISOString(),
    });
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

async function deliverMilestones(admin: ReturnType<typeof createClient>, vyom: ReturnType<typeof createClient>) {
  const { data: events, error } = await admin
    .from("pravah_integration_events")
    .select("id,source_task_id,event_type,idempotency_key,payload,attempt_count")
    .in("status", ["pending", "failed"])
    .order("occurred_at")
    .limit(100);
  if (error) throw error;
  let delivered = 0;
  let failed = 0;

  for (const event of events || []) {
    try {
      const summary = String(event.payload?.summary || event.event_type);
      const { error: receiptError } = await vyom.from("pravah_milestone_receipts").upsert({
        idempotency_key: event.idempotency_key,
        source_task_id: event.source_task_id,
        event_type: event.event_type,
        summary,
        payload: event.payload || {},
      }, { onConflict: "idempotency_key", ignoreDuplicates: false });
      if (receiptError) throw receiptError;

      const { data: task, error: taskReadError } = await vyom
        .from("tasks").select("fields").eq("id", event.source_task_id).single();
      if (taskReadError) throw taskReadError;
      const { error: taskWriteError } = await vyom.from("tasks").update({
        fields: {
          ...(task.fields || {}),
          pravah_status: summary,
          pravah_status_at: new Date().toISOString(),
          pravah_event_type: event.event_type,
          pravah_checkpoint: event.payload?.checkpoint || null,
        },
      }).eq("id", event.source_task_id);
      if (taskWriteError) throw taskWriteError;

      const { error: deliveredError } = await admin.from("pravah_integration_events").update({
        status: "delivered", delivered_at: new Date().toISOString(),
        attempt_count: Number(event.attempt_count || 0) + 1, last_error: null,
      }).eq("id", event.id);
      if (deliveredError) throw deliveredError;
      delivered += 1;
    } catch (eventError) {
      failed += 1;
      await admin.from("pravah_integration_events").update({
        status: "failed", attempt_count: Number(event.attempt_count || 0) + 1,
        last_error: eventError instanceof Error ? eventError.message : "Milestone delivery failed.",
      }).eq("id", event.id);
    }
  }
  return { delivered, failed };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
