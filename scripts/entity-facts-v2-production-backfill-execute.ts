import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Phase2CMaterializationDataset } from "./entity-facts-v2-materialize";
import {
  ENTITY_FACTS_V2_BACKFILL_CONFIRMATION,
  ENTITY_FACTS_V2_BACKFILL_PROJECT_REF,
  executeProductionEntityFactsV2Backfill,
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

function invariant(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}

async function managementRequest(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return await fetch(`${MANAGEMENT_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
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
    `BACKFILL_POOLER_CONFIG_FAILED:${response.status}`,
  );
  const body = (await response.json()) as unknown;
  invariant(Array.isArray(body), "BACKFILL_POOLER_CONFIG_INVALID");
  const primary = (body as PoolerConfig[]).find(
    (item) =>
      item?.database_type === "PRIMARY" &&
      typeof item.connection_string === "string",
  );
  invariant(
    typeof primary?.connection_string === "string",
    "BACKFILL_PRIMARY_POOLER_MISSING",
  );
  return primary.connection_string;
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
    `BACKFILL_CREATE_TEMP_ROLE_FAILED:${response.status}`,
  );
  const body = (await response.json()) as Partial<LoginRoleResponse>;
  invariant(
    typeof body.role === "string" &&
      /^cli_login_postgres(?:_|$)/u.test(body.role) &&
      typeof body.password === "string" &&
      body.password.length > 0,
    "BACKFILL_TEMP_ROLE_RESPONSE_INVALID",
  );
  return { role: body.role, password: body.password };
}

async function deleteTemporaryLoginRoles(token: string): Promise<void> {
  const response = await managementRequest(
    token,
    `/projects/${ENTITY_FACTS_V2_BACKFILL_PROJECT_REF}/cli/login-role`,
    { method: "DELETE" },
  );
  invariant(
    response.ok,
    `BACKFILL_DELETE_TEMP_ROLE_FAILED:${response.status}`,
  );
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
    "BACKFILL_POOLER_URL_INVALID",
  );
  url.username =
    `${loginRole.role}.${ENTITY_FACTS_V2_BACKFILL_PROJECT_REF}`;
  url.password = loginRole.password;
  url.port = "5432";
  if (!url.pathname || url.pathname === "/") url.pathname = "/postgres";
  url.search = "";
  return url.toString();
}

export async function runApprovedProductionBackfill(
  managementToken: string,
  dataset: Phase2CMaterializationDataset,
) {
  const token = managementToken.trim();
  invariant(token.length > 0, "BACKFILL_MANAGEMENT_TOKEN_REQUIRED");

  const pooler = await getPrimaryPoolerConnectionString(token);
  let temporaryRoleCreated = false;
  let pendingError: unknown = null;
  let summary: Awaited<
    ReturnType<typeof executeProductionEntityFactsV2Backfill>
  > | null = null;
  let temporaryLoginRoleDeleted = false;

  try {
    const loginRole = await createTemporaryLoginRole(token);
    temporaryRoleCreated = true;
    const databaseUrl = buildSessionPoolerUrl(pooler, loginRole);

    summary = await executeProductionEntityFactsV2Backfill(
      databaseUrl,
      dataset,
    );
  } catch (error) {
    pendingError = error;
  } finally {
    if (temporaryRoleCreated) {
      try {
        await deleteTemporaryLoginRoles(token);
        temporaryLoginRoleDeleted = true;
      } catch (error) {
        if (!pendingError) pendingError = error;
      }
    }
  }

  if (pendingError) throw pendingError;
  invariant(summary, "BACKFILL_SUMMARY_MISSING");
  invariant(
    temporaryLoginRoleDeleted,
    "BACKFILL_TEMP_ROLE_DELETE_NOT_CONFIRMED",
  );

  return {
    ...summary,
    temporaryLoginRoleDeleted: true as const,
  };
}

if (import.meta.main) {
  const inputPath = process.argv[2];
  const token = process.env.SUPABASE_ACCESS_TOKEN?.trim() ?? "";
  const confirmation =
    process.env.ENTITY_FACTS_V2_BACKFILL_CONFIRM?.trim() ?? "";
  const projectRef =
    process.env.ENTITY_FACTS_V2_BACKFILL_PROJECT_REF?.trim() ?? "";

  if (!inputPath || inputPath.startsWith("--")) {
    console.error(
      "Usage: bun scripts/entity-facts-v2-production-backfill-execute.ts <dataset.json>",
    );
    process.exitCode = 2;
  } else if (
    confirmation !== ENTITY_FACTS_V2_BACKFILL_CONFIRMATION ||
    projectRef !== ENTITY_FACTS_V2_BACKFILL_PROJECT_REF
  ) {
    console.error("BACKFILL_EXPLICIT_CONFIRMATION_REQUIRED");
    process.exitCode = 2;
  } else {
    const dataset = JSON.parse(
      readFileSync(resolve(inputPath), "utf8"),
    ) as Phase2CMaterializationDataset;

    const result = await runApprovedProductionBackfill(token, dataset);
    console.log(JSON.stringify(result, null, 2));
  }
}
