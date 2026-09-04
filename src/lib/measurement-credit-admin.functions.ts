import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** 내부 운영자 전용 측정권 관리 DTO (fail-closed). */
export type CreditOrgDTO = {
  orgId: string;
  name: string;
  slug: string;
  dataOrigin: "internal_observation" | "customer_measurement";
  createdAt: string;
  balance: number;
  lifetimeGranted: number;
  lifetimeConsumed: number;
  clientBusinessCount: number;
  latestLedgerAt: string | null;
};

export type CreditOverviewDTO = {
  version: string;
  generatedAt: string;
  organizations: CreditOrgDTO[];
};

export type CreditLedgerEntryDTO = {
  id: string;
  entryType: string;
  amount: number;
  balanceAfter: number;
  note: string | null;
  createdAt: string;
};

export type CreditLedgerDTO = {
  orgId: string;
  entries: CreditLedgerEntryDTO[];
};

export type CreditOverviewResponseDTO =
  | { ok: true; overview: CreditOverviewDTO }
  | { ok: false; error: "FORBIDDEN" | "NOT_AVAILABLE" };

export type CreditLedgerResponseDTO =
  | { ok: true; ledger: CreditLedgerDTO }
  | { ok: false; error: "FORBIDDEN" | "NOT_AVAILABLE" };

export type CreditGrantResponseDTO =
  | { ok: true; balanceAfter: number; idempotent: boolean }
  | { ok: false; error: "FORBIDDEN" | "INVALID_INPUT" | "NOT_AVAILABLE" };

type RpcCaller = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

const ORIGINS = ["internal_observation", "customer_measurement"] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function nullableStr(v: unknown): string | null | undefined {
  if (v === null) return null;
  return typeof v === "string" ? v : undefined;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseOrg(v: unknown): CreditOrgDTO | null {
  if (!isRecord(v)) return null;
  const orgId = str(v['orgId']);
  const name = str(v['name']);
  const slug = str(v['slug']);
  const dataOrigin = str(v['dataOrigin']);
  const createdAt = str(v['createdAt']);
  const balance = num(v['balance']);
  const lifetimeGranted = num(v['lifetimeGranted']);
  const lifetimeConsumed = num(v['lifetimeConsumed']);
  const clientBusinessCount = num(v['clientBusinessCount']);
  const latestLedgerAt = nullableStr(v['latestLedgerAt']);
  if (
    !orgId ||
    !name ||
    slug === null ||
    !dataOrigin ||
    !(ORIGINS as readonly string[]).includes(dataOrigin) ||
    !createdAt ||
    balance === null ||
    lifetimeGranted === null ||
    lifetimeConsumed === null ||
    clientBusinessCount === null ||
    latestLedgerAt === undefined
  ) {
    return null;
  }
  return {
    orgId,
    name,
    slug,
    dataOrigin: dataOrigin as CreditOrgDTO["dataOrigin"],
    createdAt,
    balance,
    lifetimeGranted,
    lifetimeConsumed,
    clientBusinessCount,
    latestLedgerAt,
  };
}

function parseOverview(payload: unknown): CreditOverviewDTO | null {
  if (!isRecord(payload)) return null;
  const version = str(payload['version']);
  const generatedAt = str(payload['generatedAt']);
  const orgsRaw = payload['organizations'];
  if (!version || !generatedAt || !Array.isArray(orgsRaw)) return null;
  const organizations: CreditOrgDTO[] = [];
  for (const raw of orgsRaw) {
    const parsed = parseOrg(raw);
    if (!parsed) return null;
    organizations.push(parsed);
  }
  return { version, generatedAt, organizations };
}

function parseEntry(v: unknown): CreditLedgerEntryDTO | null {
  if (!isRecord(v)) return null;
  const id = str(v['id']);
  const entryType = str(v['entryType']);
  const amount = num(v['amount']);
  const balanceAfter = num(v['balanceAfter']);
  const note = nullableStr(v['note']);
  const createdAt = str(v['createdAt']);
  if (!id || !entryType || amount === null || balanceAfter === null || note === undefined || !createdAt) {
    return null;
  }
  return { id, entryType, amount, balanceAfter, note, createdAt };
}

function parseLedger(payload: unknown): CreditLedgerDTO | null {
  if (!isRecord(payload)) return null;
  const orgId = str(payload['orgId']);
  const entriesRaw = payload['entries'];
  if (!orgId || !Array.isArray(entriesRaw)) return null;
  const entries: CreditLedgerEntryDTO[] = [];
  for (const raw of entriesRaw) {
    const parsed = parseEntry(raw);
    if (!parsed) return null;
    entries.push(parsed);
  }
  return { orgId, entries };
}

async function isAdmin(client: RpcCaller): Promise<boolean> {
  const { data, error } = await client.rpc("can_view_data_asset_admin_v01");
  if (error) return false;
  return data === true;
}

/** 조직별 측정권 개요. */
export const getMeasurementCreditAdminOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CreditOverviewResponseDTO> => {
    const client = context.supabase as unknown as RpcCaller;
    if (!(await isAdmin(client))) return { ok: false, error: "FORBIDDEN" };

    const { data, error } = await client.rpc("get_measurement_credit_admin_overview_v01", {
      p_limit: 100,
    });
    if (error) return { ok: false, error: "NOT_AVAILABLE" };

    const overview = parseOverview(data);
    if (!overview) return { ok: false, error: "NOT_AVAILABLE" };
    return { ok: true, overview };
  });

/** 조직 원장(최근 50개). */
export const getMeasurementCreditAdminLedger = createServerFn({ method: "POST" })
  .inputValidator((input: { orgId: string }) => {
    if (!isRecord(input) || typeof input.orgId !== "string" || !UUID_RE.test(input.orgId)) {
      throw new Error("INVALID_ORG");
    }
    return { orgId: input.orgId };
  })
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }): Promise<CreditLedgerResponseDTO> => {
    const client = context.supabase as unknown as RpcCaller;
    if (!(await isAdmin(client))) return { ok: false, error: "FORBIDDEN" };

    const res = await client.rpc("get_measurement_credit_admin_ledger_v01", {
      p_org_id: data.orgId,
      p_limit: 50,
    });
    if (res.error) return { ok: false, error: "NOT_AVAILABLE" };

    const ledger = parseLedger(res.data);
    if (!ledger) return { ok: false, error: "NOT_AVAILABLE" };
    return { ok: true, ledger };
  });

/** 측정권 지급(양수만). */
export const grantMeasurementCreditsAdmin = createServerFn({ method: "POST" })
  .inputValidator((input: { orgId: string; amount: number; note: string; referenceKey: string }) => {
    if (!isRecord(input)) throw new Error("INVALID_INPUT");
    const orgId = input['orgId'];
    const amount = input['amount'];
    const note = input['note'];
    const referenceKey = input['referenceKey'];
    if (typeof orgId !== "string" || !UUID_RE.test(orgId)) throw new Error("INVALID_INPUT");
    if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 1 || amount > 100) {
      throw new Error("INVALID_INPUT");
    }
    if (typeof note !== "string" || note.length > 300) throw new Error("INVALID_INPUT");
    if (typeof referenceKey !== "string" || referenceKey.length < 8 || referenceKey.length > 100) {
      throw new Error("INVALID_INPUT");
    }
    return { orgId, amount, note, referenceKey };
  })
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }): Promise<CreditGrantResponseDTO> => {
    const client = context.supabase as unknown as RpcCaller;
    if (!(await isAdmin(client))) return { ok: false, error: "FORBIDDEN" };

    const res = await client.rpc("admin_grant_measurement_credits_v01", {
      p_org_id: data.orgId,
      p_amount: data.amount,
      p_note: data.note,
      p_reference_key: data.referenceKey,
    });
    if (res.error) return { ok: false, error: "NOT_AVAILABLE" };

    const row = Array.isArray(res.data) ? res.data[0] : res.data;
    if (!isRecord(row)) return { ok: false, error: "NOT_AVAILABLE" };
    const balanceAfter = num(row['balance_after']);
    const idempotent = row['idempotent'];
    if (balanceAfter === null || typeof idempotent !== "boolean") {
      return { ok: false, error: "NOT_AVAILABLE" };
    }
    return { ok: true, balanceAfter, idempotent };
  });
