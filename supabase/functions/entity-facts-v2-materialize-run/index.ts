import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  ENTITY_FACTS_V2_RUNTIME_ENGINE_VERSION,
  buildEntityFactsV2RuntimeMaterialization,
  type EntityFactsV2RuntimeDataset,
  type EntityFactsV2RuntimeExistingState,
  type EntityFactsV2RuntimeRunState,
} from "../_shared/entity-engine-v2/runtime-materialization.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "content-type,x-visibility-postprocess-token",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};

type RuntimeContext = {
  run: EntityFactsV2RuntimeRunState;
  existing: EntityFactsV2RuntimeExistingState;
  dataset: EntityFactsV2RuntimeDataset;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readDefaultKey(name: string): string | undefined {
  const raw = Deno.env.get(name)?.trim();
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return undefined;
    if (
      typeof parsed.default === "string" &&
      parsed.default.trim()
    ) {
      return parsed.default.trim();
    }
    for (const value of Object.values(parsed)) {
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function env() {
  return {
    url: Deno.env.get("SUPABASE_URL")?.trim() ?? "",
    secret:
      readDefaultKey("SUPABASE_SECRET_KEYS") ??
      Deno.env.get("SUPABASE_SECRET_KEY")?.trim() ??
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ??
      "",
  };
}

function runtimeContext(value: unknown): RuntimeContext | null {
  if (!isRecord(value)) return null;
  const run = value.run;
  const existing = value.existing;
  const dataset = value.dataset;
  if (!isRecord(run) || !isRecord(existing) || !isRecord(dataset)) return null;
  if (!Array.isArray(dataset.rows) || !Array.isArray(dataset.publicIdentities)) {
    return null;
  }

  const requiredRunStrings = [
    run.runId,
    run.orgId,
    run.businessId,
    run.status,
    run.runType,
    run.phase,
  ];
  if (requiredRunStrings.some((item) => typeof item !== "string")) return null;
  if (
    !(typeof run.experimentId === "string" || run.experimentId === null) ||
    typeof run.postprocessCompleted !== "boolean" ||
    typeof run.citationAttributionCompleted !== "boolean"
  ) {
    return null;
  }

  const existingValues = [
    existing.measurementFactCount,
    existing.aggregateRowCount,
    existing.observedSourceRowCount,
    existing.competitorSourceClueRowCount,
  ];
  if (
    existingValues.some(
      (item) =>
        typeof item !== "number" ||
        !Number.isInteger(item) ||
        item < 0,
    )
  ) {
    return null;
  }

  return value as unknown as RuntimeContext;
}

async function ensureCompletionEvent(
  db: ReturnType<typeof createClient>,
  context: RuntimeContext,
  idempotent: boolean,
): Promise<void> {
  const { data: existingEvent, error: readError } = await db
    .from("system_events")
    .select("id")
    .eq("org_id", context.run.orgId)
    .eq("run_id", context.run.runId)
    .eq("event_type", "entity_facts_v2_materialization_completed")
    .eq("metadata->>engine_version", ENTITY_FACTS_V2_RUNTIME_ENGINE_VERSION)
    .limit(1)
    .maybeSingle();

  if (readError) throw new Error("RUNTIME_V2_COMPLETION_EVENT_READ_FAILED");
  if (existingEvent) return;

  const { error: eventError } = await db.from("system_events").insert({
    org_id: context.run.orgId,
    run_id: context.run.runId,
    event_type: "entity_facts_v2_materialization_completed",
    severity: "info",
    message: "Entity Facts v2 runtime materialization completed.",
    metadata: {
      engine_version: ENTITY_FACTS_V2_RUNTIME_ENGINE_VERSION,
      materializer_version: "0.1",
      idempotent,
      measurement_count: context.dataset.rows.length,
    },
  });
  if (eventError) throw new Error("RUNTIME_V2_COMPLETION_EVENT_WRITE_FAILED");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }
  if (request.method !== "POST") {
    return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  }

  const runtimeEnv = env();
  if (!runtimeEnv.url || !runtimeEnv.secret) {
    return json({ ok: false, error: "SERVER_NOT_CONFIGURED" }, 500);
  }

  const db = createClient(runtimeEnv.url, runtimeEnv.secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const supplied =
    request.headers.get("x-visibility-postprocess-token")?.trim() ?? "";
  if (!supplied) return json({ ok: false, error: "FORBIDDEN" }, 403);

  const { data: tokenRow, error: tokenError } = await db
    .from("visibility_postprocess_tokens")
    .select("name")
    .eq("token", supplied)
    .eq("active", true)
    .maybeSingle();
  if (tokenError || !tokenRow) {
    return json({ ok: false, error: "FORBIDDEN" }, 403);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "INVALID_REQUEST" }, 400);
  }
  if (!isRecord(body) || typeof body.runId !== "string") {
    return json({ ok: false, error: "INVALID_REQUEST" }, 400);
  }
  const runId = body.runId.trim();

  const { data: contextRaw, error: contextError } = await db.rpc(
    "get_entity_facts_v2_runtime_context_v01",
    { p_run_id: runId },
  );
  if (contextError) {
    return json(
      {
        ok: false,
        error: "RUNTIME_V2_CONTEXT_READ_FAILED",
        detail: contextError.message,
      },
      500,
    );
  }

  const context = runtimeContext(contextRaw);
  if (!context) {
    return json({ ok: false, error: "RUNTIME_V2_CONTEXT_INVALID" }, 409);
  }

  try {
    const result = await buildEntityFactsV2RuntimeMaterialization({
      dataset: context.dataset,
      run: context.run,
      existing: context.existing,
      materializationId: crypto.randomUUID(),
    });

    if (result.kind === "already_materialized") {
      await ensureCompletionEvent(db, context, true);
      return json({
        ok: true,
        idempotent: true,
        runId: result.runId,
        engineVersion: ENTITY_FACTS_V2_RUNTIME_ENGINE_VERSION,
      });
    }

    const { data: commitResult, error: commitError } = await db.rpc(
      "commit_entity_facts_v2_runtime_materialization_v01",
      {
        p_run_id: result.runId,
        p_materialization_id: result.materializationId,
        p_engine_version: result.engineVersion,
        p_measurement_rows: result.measurementRows,
        p_aggregate_row: result.aggregateRow,
        p_observed_supplement: result.observedSupplement,
        p_clue_supplement: result.clueSupplement,
      },
    );

    if (commitError) {
      throw new Error(
        `RUNTIME_V2_ATOMIC_COMMIT_FAILED:${commitError.message}`,
      );
    }

    const idempotent =
      isRecord(commitResult) && commitResult.idempotent === true;
    await ensureCompletionEvent(db, context, idempotent);

    return json({
      ok: true,
      idempotent,
      runId: result.runId,
      engineVersion: result.engineVersion,
      measurementFactCount: result.measurementRows.length,
      observedSourceCount:
        result.observedSupplement.observed_sources.length,
      competitorSourceClueCount:
        result.clueSupplement.source_clues.length,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "RUNTIME_V2_FAILED";
    const notReady =
      message.includes("RUNTIME_V2_POSTPROCESS_NOT_READY") ||
      message.includes("RUNTIME_V2_CITATION_ATTRIBUTION_NOT_READY");

    await db.from("system_events").insert({
      org_id: context.run.orgId,
      run_id: context.run.runId,
      event_type: notReady
        ? "entity_facts_v2_materialization_deferred"
        : "entity_facts_v2_materialization_failed",
      severity: notReady ? "warning" : "error",
      message: notReady
        ? "Entity Facts v2 runtime materialization is waiting for prerequisites."
        : "Entity Facts v2 runtime materialization failed.",
      metadata: {
        engine_version: ENTITY_FACTS_V2_RUNTIME_ENGINE_VERSION,
        error_code: message.slice(0, 300),
      },
    });

    return json(
      { ok: false, error: message },
      notReady ? 409 : 500,
    );
  }
});
