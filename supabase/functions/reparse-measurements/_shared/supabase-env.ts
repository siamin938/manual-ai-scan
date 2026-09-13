export interface SupabaseRuntimeEnv {
  url?: string;
  publishableKey?: string;
  secretKey?: string;
}

function readDefaultKey(jsonEnvName: string): string | undefined {
  const raw = Deno.env.get(jsonEnvName)?.trim();
  if (!raw) return undefined;

  try {
    const parsed = JSON.parse(raw) as unknown;

    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return undefined;
    }

    const dictionary = parsed as Record<string, unknown>;

    if (
      typeof dictionary.default === "string" &&
      dictionary.default.trim()
    ) {
      return dictionary.default.trim();
    }

    for (const value of Object.values(dictionary)) {
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  } catch {
    // Hosted Supabase / legacy environment compatibility
  }

  return undefined;
}

export function getSupabaseRuntimeEnv(): SupabaseRuntimeEnv {
  return {
    url:
      Deno.env.get("SUPABASE_URL")?.trim() ||
      undefined,

    publishableKey:
      readDefaultKey("SUPABASE_PUBLISHABLE_KEYS") ??
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY")?.trim() ??
      Deno.env.get("SUPABASE_ANON_KEY")?.trim() ??
      undefined,

    secretKey:
      readDefaultKey("SUPABASE_SECRET_KEYS") ??
      Deno.env.get("SUPABASE_SECRET_KEY")?.trim() ??
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ??
      undefined,
  };
}
