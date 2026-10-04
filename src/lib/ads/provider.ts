export type AdNetworkProvider = "clickadu" | "adsterra" | "all" | "none";

/**
 * Xác định nhà mạng quảng cáo hoạt động trên website.
 * Mặc định kích hoạt 'all' (bao gồm cả Adsterra và Clickadu).
 * Có thể điều khiển linh hoạt qua biến môi trường AD_PROVIDER ("all" | "adsterra" | "clickadu" | "none").
 */
export function getActiveAdProvider(env: Record<string, string | undefined> = process.env): AdNetworkProvider {
  const raw = String(env.AD_PROVIDER ?? "all").trim().toLowerCase();
  if (raw === "adsterra") return "adsterra";
  if (raw === "clickadu") return "clickadu";
  if (raw === "none") return "none";
  return "all";
}

export function isAdsterraActive(env: Record<string, string | undefined> = process.env): boolean {
  const provider = getActiveAdProvider(env);
  return provider === "adsterra" || provider === "all";
}

export function isClickaduActive(env: Record<string, string | undefined> = process.env): boolean {
  const provider = getActiveAdProvider(env);
  return provider === "clickadu" || provider === "all";
}
