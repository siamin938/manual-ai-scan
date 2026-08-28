import { attributeAndPersistRunCitations } from "/dev-server/src/lib/citation-attribution.server";
const runId = "cb08c8b4-479d-4cbd-9175-c705d4d71c61";
const { supabaseAdmin } = await import("/dev-server/src/integrations/supabase/client.server");
const { data: run } = await supabaseAdmin.from("measurement_runs").select("org_id,business_id").eq("id", runId).single();
const summary = await attributeAndPersistRunCitations({ orgId: run!.org_id as string, businessId: run!.business_id as string, runId });
console.log(JSON.stringify(summary, null, 2));
