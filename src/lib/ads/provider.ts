export type AdNetworkProvider = "adcash" | "clickadu" | "adsterra" | "all" | "none";

/**
 * Xác định nhà mạng quảng cáo hoạt động trên website.
 * Mặc định kích hoạt 'adcash' (AutoTag) theo yêu cầu.
 * Có thể điều khiển linh hoạt qua biến môi trường AD_PROVIDER ("adcash" | "clickadu" | "adsterra" | "all" | "none").
 */
export function getActiveAdProvider(env: Record<string, string | undefined> = process.env): AdNetworkProvider {
  const raw = String(env.AD_PROVIDER ?? "adcash").trim().toLowerCase();
  if (raw === "none") return "none";
  if (raw === "clickadu") return "clickadu";
  if (raw === "adsterra") return "adsterra";
  if (raw === "all") return "all";
  return "adcash";
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
