export type AdNetworkProvider = "adcash" | "clickadu" | "adsterra" | "all" | "none";

/**
 * Xác định nhà mạng quảng cáo hoạt động trên website.
 * Mặc định 'none' (vô hiệu hoá toàn bộ mạng quảng cáo theo yêu cầu).
 * Có thể điều khiển linh hoạt qua biến môi trường AD_PROVIDER ("none" | "adcash" | "clickadu" | "adsterra" | "all").
 */
export function getActiveAdProvider(env: Record<string, string | undefined> = process.env): AdNetworkProvider {
  const raw = String(env.AD_PROVIDER ?? "none").trim().toLowerCase();
  if (raw === "adcash") return "adcash";
  if (raw === "clickadu") return "clickadu";
  if (raw === "adsterra") return "adsterra";
  if (raw === "all") return "all";
  return "none";
}

export function isAdcashActive(env: Record<string, string | undefined> = process.env): boolean {
  const provider = getActiveAdProvider(env);
  return provider === "adcash" || provider === "all";
}

export function isAdsterraActive(env: Record<string, string | undefined> = process.env): boolean {
  const provider = getActiveAdProvider(env);
  return provider === "adsterra" || provider === "all";
}

export function isClickaduActive(env: Record<string, string | undefined> = process.env): boolean {
  const provider = getActiveAdProvider(env);
  return provider === "clickadu" || provider === "all";
}

export function isAdSenseActive(env: Record<string, string | undefined> = process.env): boolean {
  const provider = getActiveAdProvider(env);
  return provider !== "none";
}
