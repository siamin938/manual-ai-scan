export function normalizeDomain(urlOrDomain: string): string | undefined {
  const value = urlOrDomain.trim();
  if (!value) return undefined;

  try {
    const url = value.includes("://")
      ? new URL(value)
      : new URL(`https://${value}`);

    return url.hostname
      .toLowerCase()
      .replace(/^www\./, "");
  } catch {
    return undefined;
  }
}
