import { createClient } from "jsr:@supabase/supabase-js@2";

const MAX_ORGS_PER_TICK = 5;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readKey(name: string): string | undefined {
  const raw = Deno.env.get(name)?.trim();
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return raw;
    if (typeof parsed.default === "string" && parsed.default.trim()) {
      return parsed.default.trim();
    }
    for (const value of Object.values(parsed)) {
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  } catch {
    return raw;
  }
  return undefined;
}

function env() {
  return {
    url: Deno.env.get("SUPABASE_URL")?.trim() ?? "",
    publishableKey:
      Deno.env.get("SUPABASE_ANON_KEY")?.trim() ??
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY")?.trim() ??
      "",
    serviceRoleKey:
      readKey("SUPABASE_SECRET_KEYS") ??
      Deno.env.get("SUPABASE_SECRET_KEY")?.trim() ??
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ??
      "",
    internalSecret: Deno.env.get("INTERNAL_CRON_SECRET")?.trim() ?? "",
  };
}

function constantTimeEquals(a: string, b: string): boolean {
  const aa = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  let diff = aa.length ^ bb.length;
  const length = Math.max(aa.length, bb.length);
  for (let i = 0; i < length; i += 1) {
    diff |= (aa[i % Math.max(1, aa.length)] ?? 0) ^
      (bb[i % Math.max(1, bb.length)] ?? 0);
  }
  return diff === 0;
}

async function logEvent(
  db: ReturnType<typeof createClient>,
  args: {
    orgId: string;
    runId?: string | null;
    eventType: string;
    severity: "info" | "warning" | "error";
    message: string;
    metadata?: Record<string, unknown>;
  },
) {
  await db.from("system_events").insert({
    org_id: args.orgId,
    run_id: args.runId ?? null,
    event_type: args.eventType,
    severity: args.severity,
    message: args.message,
    metadata: {
      ...(args.metadata ?? {}),
      scheduler_version: "0.7",
      unattended_executor: true,
    },
  });
}

async function markStartupFailure(
  db: ReturnType<typeof createClient>,
  args: {
    itemId: string;
    code: string;
    message: string;
    runId?: string | null;
  },
) {
  const now = new Date().toISOString();
  if (args.runId) {
    const { count } = await db
      .from("measurement_jobs")
      .select("id", { count: "exact", head: true })
      .eq("run_id", args.runId);

    const { data: run } = await db
      .from("measurement_runs")
      .select("status")
      .eq("id", args.runId)
      .maybeSingle();

    if ((count ?? 0) > 0 || (run && run.status !== "draft")) {
      // Enqueue may have succeeded and only the HTTP response was lost.
      // Leave the pipeline measuring so reconciliation can settle the exact Run.
      await db
        .from("internal_observation_pipeline_items")
        .update({
          error_code: "SCHEDULER_ENQUEUE_RESPONSE_UNCERTAIN",
          error_message:
            "enqueue 응답은 불확실하지만 Job 또는 Run 진행 상태가 확인되어 자동 취소하지 않습니다.",
          updated_at: now,
        })
        .eq("id", args.itemId)
        .eq("status", "measuring");
      return "uncertain" as const;
    }

    await db
      .from("measurement_runs")
      .update({
        status: "cancelled",
        completed_at: now,
        updated_at: now,
      })
      .eq("id", args.runId)
      .eq("status", "draft");
  }

  await db
    .from("internal_observation_pipeline_items")
    .update({
      status: "failed",
      terminal_at: now,
      reconciled_at: now,
      error_code: args.code,
      error_message: args.message,
      updated_at: now,
    })
    .eq("id", args.itemId)
    .eq("status", "measuring");

  return "failed" as const;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const cfg = env();
  if (!cfg.url || !cfg.publishableKey || !cfg.serviceRoleKey || !cfg.internalSecret) {
    return json({ error: "SERVER_NOT_CONFIGURED" }, 500);
  }

  const suppliedSecret = request.headers.get("x-internal-secret")?.trim() ?? "";
  if (!suppliedSecret || !constantTimeEquals(cfg.internalSecret, suppliedSecret)) {
    return json({ error: "FORBIDDEN" }, 403);
  }

  const db = createClient(cfg.url, cfg.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: settingsRows, error: settingsError } = await db
    .from("internal_observation_pipeline_settings")
    .select("org_id,scheduler_actor_user_id")
    .eq("execution_enabled", true)
    .eq("scheduler_state", "running")
    .eq("scheduler_executor_ready", true)
    .order("updated_at", { ascending: true })
    .limit(MAX_ORGS_PER_TICK);

  if (settingsError) {
    console.error(JSON.stringify({
      function: "internal-observation-scheduler-tick",
      code: "SETTINGS_READ_FAILED",
      message: settingsError.message,
    }));
    return json({ error: "SETTINGS_READ_FAILED" }, 500);
  }

  const summary = {
    ok: true,
    schedulerVersion: "0.7",
    eligibleOrgs: settingsRows?.length ?? 0,
    started: 0,
    idle: 0,
    failed: 0,
    uncertain: 0,
    results: [] as Record<string, unknown>[],
  };

  for (const settings of settingsRows ?? []) {
    const orgId = String(settings.org_id ?? "");
    const actorUserId = String(settings.scheduler_actor_user_id ?? "");
    if (!orgId || !actorUserId) {
      summary.failed += 1;
      summary.results.push({ orgId, status: "failed", code: "ACTOR_NOT_CONFIGURED" });
      continue;
    }

    try {
      await db.rpc("reconcile_internal_observation_scheduler_v07", {
        p_org_id: orgId,
      });

      // Re-read the fuse after reconciliation so pause/stop wins before claim.
      const { data: gate } = await db
        .from("internal_observation_pipeline_settings")
        .select("execution_enabled,scheduler_state,scheduler_executor_ready,scheduler_actor_user_id")
        .eq("org_id", orgId)
        .maybeSingle();

      if (
        !gate ||
        gate.execution_enabled !== true ||
        gate.scheduler_state !== "running" ||
        gate.scheduler_executor_ready !== true ||
        gate.scheduler_actor_user_id !== actorUserId
      ) {
        summary.idle += 1;
        summary.results.push({ orgId, status: "idle", code: "GATE_CLOSED" });
        continue;
      }

      const { data: claimedRaw, error: claimError } = await db.rpc(
        "claim_internal_observation_scheduler_candidate_v07",
        {
          p_org_id: orgId,
          p_actor_user_id: actorUserId,
        },
      );
      if (claimError) throw new Error(`CLAIM_FAILED:${claimError.message}`);

      const claimed = Array.isArray(claimedRaw) ? claimedRaw[0] : claimedRaw;
      if (!isRecord(claimed)) {
        summary.idle += 1;
        summary.results.push({ orgId, status: "idle", code: "NO_ELIGIBLE_CANDIDATE" });
        continue;
      }

      const itemId = String(claimed.item_id ?? "");
      const businessName = String(claimed.business_name ?? "");
      if (!itemId) throw new Error("CLAIM_RESPONSE_INVALID");

      const { data: runRaw, error: runError } = await db.rpc(
        "create_internal_observation_scheduler_run_v07",
        {
          p_item_id: itemId,
          p_actor_user_id: actorUserId,
        },
      );

      if (runError) {
        await markStartupFailure(db, {
          itemId,
          code: "SCHEDULER_RUN_CREATE_FAILED",
          message:
            "자동 스케줄러가 Run 생성 직전 안전 조건을 통과하지 못했습니다. 자동 재시도하지 않습니다.",
        });
        await logEvent(db, {
          orgId,
          eventType: "internal_scheduler_run_create_failed",
          severity: "error",
          message: "Unattended scheduler failed before Run creation.",
          metadata: { item_id: itemId, error: runError.message.slice(0, 300) },
        });
        summary.failed += 1;
        summary.results.push({ orgId, itemId, status: "failed", code: "RUN_CREATE_FAILED" });
        continue;
      }

      const runRow = Array.isArray(runRaw) ? runRaw[0] : runRaw;
      if (!isRecord(runRow) || typeof runRow.run_id !== "string") {
        await markStartupFailure(db, {
          itemId,
          code: "SCHEDULER_RUN_RESPONSE_INVALID",
          message: "자동 스케줄러 Run 생성 결과를 확인할 수 없습니다. 자동 재시도하지 않습니다.",
        });
        summary.failed += 1;
        summary.results.push({ orgId, itemId, status: "failed", code: "RUN_RESPONSE_INVALID" });
        continue;
      }

      const runId = String(runRow.run_id);
      const enqueueResponse = await fetch(`${cfg.url}/functions/v1/enqueue-run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: cfg.publishableKey,
          "x-internal-secret": cfg.internalSecret,
        },
        body: JSON.stringify({
          runId,
          internalSchedulerItemId: itemId,
          internalSchedulerActorUserId: actorUserId,
        }),
      });

      let enqueueBody: unknown = null;
      try {
        enqueueBody = await enqueueResponse.json();
      } catch {
        enqueueBody = null;
      }

      if (!enqueueResponse.ok) {
        const outcome = await markStartupFailure(db, {
          itemId,
          runId,
          code: "SCHEDULER_ENQUEUE_FAILED",
          message:
            "자동 스케줄러가 측정 Job 등록에 실패했습니다. 자동으로 replacement Run을 만들지 않습니다.",
        });

        await logEvent(db, {
          orgId,
          runId,
          eventType:
            outcome === "uncertain"
              ? "internal_scheduler_enqueue_response_uncertain"
              : "internal_scheduler_enqueue_failed",
          severity: outcome === "uncertain" ? "warning" : "error",
          message:
            outcome === "uncertain"
              ? "Enqueue response was uncertain; existing Run/Jobs were preserved."
              : "Unattended scheduler enqueue failed; no replacement Run will be created.",
          metadata: {
            item_id: itemId,
            http_status: enqueueResponse.status,
            enqueue_response: isRecord(enqueueBody)
              ? enqueueBody
              : null,
          },
        });

        if (outcome === "uncertain") summary.uncertain += 1;
        else summary.failed += 1;
        summary.results.push({
          orgId,
          itemId,
          runId,
          status: outcome,
          code: "ENQUEUE_FAILED",
        });
        continue;
      }

      await db
        .from("internal_observation_pipeline_settings")
        .update({
          last_scheduler_tick_at: new Date().toISOString(),
          last_scheduler_result: `started:${itemId}:${runId}`,
          updated_at: new Date().toISOString(),
        })
        .eq("org_id", orgId);

      await logEvent(db, {
        orgId,
        runId,
        eventType: "internal_scheduler_run_started",
        severity: "info",
        message: "Unattended scheduler started one internal observation Run.",
        metadata: {
          item_id: itemId,
          business_name: businessName,
          enqueue_response: isRecord(enqueueBody) ? enqueueBody : null,
        },
      });

      summary.started += 1;
      summary.results.push({
        orgId,
        itemId,
        runId,
        businessName,
        status: "started",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "UNEXPECTED_ERROR";
      await db
        .from("internal_observation_pipeline_settings")
        .update({
          last_scheduler_tick_at: new Date().toISOString(),
          last_scheduler_result: `failed:${message.slice(0, 300)}`,
          updated_at: new Date().toISOString(),
        })
        .eq("org_id", orgId);

      await logEvent(db, {
        orgId,
        eventType: "internal_scheduler_tick_failed",
        severity: "error",
        message: "Unattended scheduler tick failed for an organization.",
        metadata: { error: message.slice(0, 500) },
      });

      summary.failed += 1;
      summary.results.push({ orgId, status: "failed", code: message.slice(0, 200) });
    }
  }

  return json(summary);
});
