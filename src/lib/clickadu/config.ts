import { normalizeDomainHost } from "@/lib/domains/catalog";

/**
 * Clickadu site verification token copied from Clickadu publisher panel.
 * Meta tag: <meta name="clckd" content="e78045ddae492ded91a0b9f89210f895" />
 */
export const CLICKADU_SITE_VERIFICATION_TOKEN = "e78045ddae492ded91a0b9f89210f895" as const;

export type ClickaduEnvironment = Readonly<Record<string, string | undefined>>;

const DISABLED_VALUES = new Set(["1", "true", "yes", "on"]);
const OFFICIAL_AD_HOSTS = new Set(["auto-hh3d.online", "www.auto-hh3d.online"]);

export function clickaduEnabled(
  host: string | null | undefined,
  env: ClickaduEnvironment = process.env,
): boolean {
  const disabled = DISABLED_VALUES.has(
    String(env.CLICKADU_DISABLED ?? "").trim().toLowerCase(),
  );
  return env.NODE_ENV === "production" && isOfficialClickaduHost(host) && !disabled;
}

export function isOfficialClickaduHost(host: string | null | undefined): boolean {
  return OFFICIAL_AD_HOSTS.has(normalizeDomainHost(host));
}
