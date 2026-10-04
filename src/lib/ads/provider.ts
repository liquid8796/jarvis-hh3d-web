export type AdNetworkProvider = "clickadu" | "adsterra" | "all" | "none";

/**
 * Xác định nhà mạng quảng cáo hoạt động trên website.
 * Mặc định chuyển sang 'clickadu' và tạm thời vô hiệu hoá 'adsterra' theo yêu cầu.
 * Có thể điều khiển linh hoạt qua biến môi trường AD_PROVIDER ("clickadu" | "adsterra" | "all" | "none").
 */
export function getActiveAdProvider(env: Record<string, string | undefined> = process.env): AdNetworkProvider {
  const raw = String(env.AD_PROVIDER ?? "clickadu").trim().toLowerCase();
  if (raw === "adsterra") return "adsterra";
  if (raw === "all") return "all";
  if (raw === "none") return "none";
  return "clickadu";
}

export function isAdsterraActive(env: Record<string, string | undefined> = process.env): boolean {
  const provider = getActiveAdProvider(env);
  return provider === "adsterra" || provider === "all";
}

export function isClickaduActive(env: Record<string, string | undefined> = process.env): boolean {
  const provider = getActiveAdProvider(env);
  return provider === "clickadu" || provider === "all";
}
