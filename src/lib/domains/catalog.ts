export const OFFICIAL_DOMAIN = "auto-hh3d.online" as const;
export const RETIRED_DOMAIN = "auto-hh3d.vercel.app" as const;
export const OFFICIAL_ORIGIN = `https://${OFFICIAL_DOMAIN}` as const;
export const RETIRED_ORIGIN = `https://${RETIRED_DOMAIN}` as const;

export type DomainLifecycle = "active" | "dead";

export type ManagedDomain = Readonly<{
  hostname: string;
  origin: string;
  status: DomainLifecycle;
  statusLabel: "hoạt động" | "đã chết";
  title: string;
  role: string;
}>;

/**
 * Sổ tên miền dùng chung cho trang Tên Miền công khai và Proxy đóng gương trạm. Một nguồn duy nhất
 * tránh tình trạng UI bảo một tên miền đã chết trong khi routing vẫn gửi worker tới đó.
 */
export const DOMAIN_CATALOG: readonly ManagedDomain[] = Object.freeze([
  Object.freeze({
    hostname: OFFICIAL_DOMAIN,
    origin: OFFICIAL_ORIGIN,
    status: "active",
    statusLabel: "hoạt động",
    title: "Tên miền chính thức",
    role: "Cổng truy cập chính",
  }),
  Object.freeze({
    hostname: RETIRED_DOMAIN,
    origin: RETIRED_ORIGIN,
    status: "dead",
    statusLabel: "đã chết",
    title: "Gương trạm đã đóng",
    role: "Chỉ còn trang thông báo",
  }),
]);

export function normalizeDomainHost(value: string | null | undefined): string {
  const first = String(value ?? "").split(",", 1)[0]?.trim().toLowerCase() ?? "";
  if (!first) return "";
  if (first.startsWith("[")) {
    const end = first.indexOf("]");
    return end >= 0 ? first.slice(1, end) : first;
  }
  return first.replace(/:\d+$/, "").replace(/\.$/, "");
}

export function isRetiredDomainHost(value: string | null | undefined): boolean {
  return normalizeDomainHost(value) === RETIRED_DOMAIN;
}

export function officialUrlFor(pathname = "/", search = ""): string {
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const query = search && !search.startsWith("?") ? `?${search}` : search;
  return `${OFFICIAL_ORIGIN}${path}${query}`;
}
