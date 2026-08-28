/**
 * Citation attribution endpoint for the Supabase postprocess pipeline.
 *
 * Auth: `x-postprocess-token` must match an active row in
 * `public.visibility_postprocess_tokens` (same token mechanism as the existing
 * `visibility-citation-sync` step). No provider/OpenAI call is ever made here.
 * Response is a minimal counts DTO — no evidence, indices or raw payloads.
 */
import { createFileRoute } from "@tanstack/react-router";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/api/public/citation-attribution")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = request.headers.get("x-postprocess-token");
        if (!token) return new Response("Unauthorized", { status: 401 });

        let body: { run_id?: unknown };
        try {
          body = (await request.json()) as { run_id?: unknown };
        } catch {
          return new Response("Bad Request", { status: 400 });
        }
        const runId = typeof body.run_id === "string" ? body.run_id : "";
        if (!UUID_RE.test(runId)) return new Response("Bad Request", { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: tokenRow } = await supabaseAdmin
          .from("visibility_postprocess_tokens")
          .select("name")
          .eq("token", token)
          .eq("active", true)
          .maybeSingle();
        if (!tokenRow) return new Response("Unauthorized", { status: 401 });

        const { data: run } = await supabaseAdmin
          .from("measurement_runs")
          .select("id, org_id, business_id, run_type, phase, status")
          .eq("id", runId)
          .maybeSingle();
        if (!run) return new Response("Not Found", { status: 404 });
        if (
          run.run_type !== "audit" ||
          run.phase !== "standalone" ||
          (run.status !== "completed" && run.status !== "partial")
        ) {
          return Response.json({ ok: true, skipped: true });
        }

        try {
          const { attributeAndPersistRunCitations } = await import(
            "@/lib/citation-attribution.server"
          );
          const summary = await attributeAndPersistRunCitations({
            orgId: run.org_id as string,
            businessId: run.business_id as string,
            runId,
          });
          return Response.json({
            ok: true,
            attributionVersion: summary.attributionVersion,
            measurementCount: summary.measurementCount,
            directCount: summary.directCount,
            sectionCount: summary.sectionCount,
          });
        } catch {
          return Response.json({ ok: false, error: "CITATION_ATTRIBUTION_FAILED" }, { status: 500 });
        }
      },
    },
  },
});
