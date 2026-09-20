import postgres from "postgres";
import {
  ENTITY_FACTS_V2_BACKFILL_PROJECT_REF,
} from "./entity-facts-v2-production-backfill";

const MANAGEMENT_API_BASE = "https://api.supabase.com/v1";
const EXPECTED_POOLER_SUFFIX = ".pooler.supabase.com";

interface LoginRoleResponse {
  role: string;
  password: string;
}

interface PoolerConfig {
  database_type?: string | null;
  connection_string?: string | null;
}

interface PreflightSummary {
  projectRef: typeof ENTITY_FACTS_V2_BACKFILL_PROJECT_REF;
  sessionUser: string;
  currentUser: "service_role";
  measurementFactRows: 0;
  aggregateRows: 0;
  facts: {
    select: true;
    insert: true;
    update: false;
    delete: false;
    truncate: false;
    rls: true;
    forceRls: true;
  };
  aggregates: {
    select: true;
    insert: true;
    update: false;
    delete: false;
    truncate: false;
    rls: true;
    forceRls: true;
  };
  triggers: {
    measurementScope: true;
    measurementImmutable: true;
    aggregateMaterialization: true;
    aggregateImmutable: true;
  };
  temporaryLoginRoleDeleted: true;
}

function invariant(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}

async function managementRequest(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const response = await fetch(`${MANAGEMENT_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  return response;
}

async function createTemporaryLoginRole(
  token: string,
): Promise<LoginRoleResponse> {
  const response = await managementRequest(
    token,
    `/projects/${ENTITY_FACTS_V2_BACKFILL_PROJECT_REF}/cli/login-role`,
    {
      method: "POST",
      body: JSON.stringify({ read_only: false }),
    },
  );
  invariant(
    response.status === 201,
    `PREFLIGHT_CREATE_TEMP_ROLE_FAILED:${response.status}`,
  );
  const body = (await response.json()) as Partial<LoginRoleResponse>;
  invariant(
    typeof body.role === "string" &&
      /^cli_login_postgres(?:_|$)/u.test(body.role) &&
      typeof body.password === "string" &&
      body.password.length > 0,
    "PREFLIGHT_TEMP_ROLE_RESPONSE_INVALID",
  );
  return {
    role: body.role,
    password: body.password,
  };
}

async function deleteTemporaryLoginRoles(token: string): Promise<void> {
  const response = await managementRequest(
    token,
    `/projects/${ENTITY_FACTS_V2_BACKFILL_PROJECT_REF}/cli/login-role`,
    { method: "DELETE" },
  );
  invariant(
    response.ok,
    `PREFLIGHT_DELETE_TEMP_ROLE_FAILED:${response.status}`,
  );
}

async function getPrimaryPoolerConnectionString(
  token: string,
): Promise<string> {
  const response = await managementRequest(
    token,
    `/projects/${ENTITY_FACTS_V2_BACKFILL_PROJECT_REF}/config/database/pooler`,
  );
  invariant(
    response.ok,
    `PREFLIGHT_POOLER_CONFIG_FAILED:${response.status}`,
  );
  const body = (await response.json()) as unknown;
  invariant(Array.isArray(body), "PREFLIGHT_POOLER_CONFIG_INVALID");
  const primary = (body as PoolerConfig[]).find(
    (item) =>
      item?.database_type === "PRIMARY" &&
      typeof item.connection_string === "string",
  );
  invariant(
    typeof primary?.connection_string === "string",
    "PREFLIGHT_PRIMARY_POOLER_MISSING",
  );
  return primary.connection_string;
}

function buildSessionPoolerUrl(
  connectionString: string,
  loginRole: LoginRoleResponse,
): string {
  const placeholderSafe = connectionString.replaceAll(
    "[YOUR-PASSWORD]",
    "placeholder",
  );
  const url = new URL(placeholderSafe);
  invariant(
    (url.protocol === "postgres:" || url.protocol === "postgresql:") &&
      url.hostname.endsWith(EXPECTED_POOLER_SUFFIX),
    "PREFLIGHT_POOLER_URL_INVALID",
  );
  url.username =
    `${loginRole.role}.${ENTITY_FACTS_V2_BACKFILL_PROJECT_REF}`;
  url.password = loginRole.password;
  url.port = "5432";
  if (!url.pathname || url.pathname === "/") {
    url.pathname = "/postgres";
  }
  url.search = "";
  return url.toString();
}

function booleanValue(value: unknown): boolean {
  return value === true || value === "true" || value === "t";
}

function numberValue(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  invariant(Number.isFinite(parsed), "PREFLIGHT_NUMERIC_RESULT_INVALID");
  return parsed;
}

export async function runEntityFactsV2ProductionPreflight(
  managementToken: string,
): Promise<PreflightSummary> {
  const token = managementToken.trim();
  invariant(token.length > 0, "PREFLIGHT_MANAGEMENT_TOKEN_REQUIRED");

  let loginRole: LoginRoleResponse | null = null;
  let temporaryRoleCreated = false;
  let deleteSucceeded = false;
  let db: ReturnType<typeof postgres> | null = null;
  let pendingError: unknown = null;
  let summary: Omit<PreflightSummary, "temporaryLoginRoleDeleted"> | null =
    null;

  try {
    const pooler = await getPrimaryPoolerConnectionString(token);
    loginRole = await createTemporaryLoginRole(token);
    temporaryRoleCreated = true;
    const databaseUrl = buildSessionPoolerUrl(pooler, loginRole);

    db = postgres(databaseUrl, {
      ssl: "require",
      max: 1,
      prepare: false,
      connect_timeout: 15,
      idle_timeout: 5,
      max_lifetime: 120,
      connection: {
        application_name: "chaboim-entity-facts-v2-production-preflight",
      },
    });

    summary = await db.begin(async (tx) => {
      await tx.unsafe("set transaction isolation level serializable");
      await tx.unsafe("set local role service_role");
      await tx.unsafe("set local statement_timeout = '30s'");
      await tx.unsafe("set local lock_timeout = '3s'");

      const roleRows = await tx.unsafe(
        `
          select
            session_user::text as session_user,
            current_user::text as current_user
        `,
      );
      invariant(roleRows.length === 1, "PREFLIGHT_ROLE_CHECK_MISSING");
      const sessionUser = String(roleRows[0]?.session_user ?? "");
      const currentUser = String(roleRows[0]?.current_user ?? "");
      invariant(
        /^cli_login_postgres(?:_|$)/u.test(sessionUser),
        "PREFLIGHT_TEMP_CLI_SESSION_REQUIRED",
      );
      invariant(
        currentUser === "service_role",
        "PREFLIGHT_SERVICE_ROLE_DOWNGRADE_FAILED",
      );

      const counts = await tx.unsafe(
        `
          select
            (select count(*) from public.measurement_entity_facts_v2)
              as measurement_fact_rows,
            (select count(*) from public.run_entity_fact_aggregates_v2)
              as aggregate_rows
        `,
      );
      invariant(counts.length === 1, "PREFLIGHT_COUNT_CHECK_MISSING");
      const measurementFactRows = numberValue(
        counts[0]?.measurement_fact_rows,
      );
      const aggregateRows = numberValue(counts[0]?.aggregate_rows);
      invariant(
        measurementFactRows === 0 && aggregateRows === 0,
        `PREFLIGHT_TABLES_NOT_EMPTY:${measurementFactRows}:${aggregateRows}`,
      );

      const privileges = await tx.unsafe(
        `
          select
            has_table_privilege(
              current_user,
              'public.measurement_entity_facts_v2',
              'SELECT'
            ) as facts_select,
            has_table_privilege(
              current_user,
              'public.measurement_entity_facts_v2',
              'INSERT'
            ) as facts_insert,
            has_table_privilege(
              current_user,
              'public.measurement_entity_facts_v2',
              'UPDATE'
            ) as facts_update,
            has_table_privilege(
              current_user,
              'public.measurement_entity_facts_v2',
              'DELETE'
            ) as facts_delete,
            has_table_privilege(
              current_user,
              'public.measurement_entity_facts_v2',
              'TRUNCATE'
            ) as facts_truncate,
            has_table_privilege(
              current_user,
              'public.run_entity_fact_aggregates_v2',
              'SELECT'
            ) as aggregates_select,
            has_table_privilege(
              current_user,
              'public.run_entity_fact_aggregates_v2',
              'INSERT'
            ) as aggregates_insert,
            has_table_privilege(
              current_user,
              'public.run_entity_fact_aggregates_v2',
              'UPDATE'
            ) as aggregates_update,
            has_table_privilege(
              current_user,
              'public.run_entity_fact_aggregates_v2',
              'DELETE'
            ) as aggregates_delete,
            has_table_privilege(
              current_user,
              'public.run_entity_fact_aggregates_v2',
              'TRUNCATE'
            ) as aggregates_truncate
        `,
      );
      invariant(
        privileges.length === 1,
        "PREFLIGHT_PRIVILEGE_CHECK_MISSING",
      );
      const p = privileges[0]!;
      invariant(
        booleanValue(p.facts_select) &&
          booleanValue(p.facts_insert) &&
          !booleanValue(p.facts_update) &&
          !booleanValue(p.facts_delete) &&
          !booleanValue(p.facts_truncate) &&
          booleanValue(p.aggregates_select) &&
          booleanValue(p.aggregates_insert) &&
          !booleanValue(p.aggregates_update) &&
          !booleanValue(p.aggregates_delete) &&
          !booleanValue(p.aggregates_truncate),
        "PREFLIGHT_APPEND_ONLY_PRIVILEGES_INVALID",
      );

      const relationRows = await tx.unsafe(
        `
          select
            c.relname,
            c.relrowsecurity,
            c.relforcerowsecurity
          from pg_catalog.pg_class c
          join pg_catalog.pg_namespace n on n.oid=c.relnamespace
          where n.nspname='public'
            and c.relname in (
              'measurement_entity_facts_v2',
              'run_entity_fact_aggregates_v2'
            )
          order by c.relname
        `,
      );
      invariant(
        relationRows.length === 2 &&
          relationRows.every(
            (row) =>
              booleanValue(row.relrowsecurity) &&
              booleanValue(row.relforcerowsecurity),
          ),
        "PREFLIGHT_RLS_CONTRACT_INVALID",
      );

      const triggerRows = await tx.unsafe(
        `
          select tg.tgname
          from pg_catalog.pg_trigger tg
          join pg_catalog.pg_class c on c.oid=tg.tgrelid
          join pg_catalog.pg_namespace n on n.oid=c.relnamespace
          where n.nspname='public'
            and c.relname in (
              'measurement_entity_facts_v2',
              'run_entity_fact_aggregates_v2'
            )
            and not tg.tgisinternal
            and tg.tgenabled <> 'D'
        `,
      );
      const triggerNames = new Set(
        triggerRows.map((row) => String(row.tgname)),
      );
      invariant(
        triggerNames.has("measurement_entity_facts_v2_validate_scope") &&
          triggerNames.has("measurement_entity_facts_v2_immutable") &&
          triggerNames.has(
            "run_entity_fact_aggregates_v2_validate_materialization",
          ) &&
          triggerNames.has("run_entity_fact_aggregates_v2_immutable"),
        "PREFLIGHT_TRIGGER_CONTRACT_INVALID",
      );

      return {
        projectRef: ENTITY_FACTS_V2_BACKFILL_PROJECT_REF,
        sessionUser,
        currentUser: "service_role" as const,
        measurementFactRows: 0 as const,
        aggregateRows: 0 as const,
        facts: {
          select: true as const,
          insert: true as const,
          update: false as const,
          delete: false as const,
          truncate: false as const,
          rls: true as const,
          forceRls: true as const,
        },
        aggregates: {
          select: true as const,
          insert: true as const,
          update: false as const,
          delete: false as const,
          truncate: false as const,
          rls: true as const,
          forceRls: true as const,
        },
        triggers: {
          measurementScope: true as const,
          measurementImmutable: true as const,
          aggregateMaterialization: true as const,
          aggregateImmutable: true as const,
        },
      };
    });
  } catch (error) {
    pendingError = error;
  } finally {
    if (db) {
      await db.end({ timeout: 5 }).catch(() => undefined);
    }
    if (temporaryRoleCreated) {
      try {
        await deleteTemporaryLoginRoles(token);
        deleteSucceeded = true;
      } catch (error) {
        if (!pendingError) pendingError = error;
      }
    }
  }

  if (pendingError) throw pendingError;
  invariant(summary, "PREFLIGHT_SUMMARY_MISSING");
  invariant(deleteSucceeded, "PREFLIGHT_TEMP_ROLE_DELETE_NOT_CONFIRMED");

  return {
    ...summary,
    temporaryLoginRoleDeleted: true,
  };
}

if (import.meta.main) {
  const token = process.env.SUPABASE_ACCESS_TOKEN?.trim() ?? "";
  const summary = await runEntityFactsV2ProductionPreflight(token);
  console.log(JSON.stringify(summary, null, 2));
}
