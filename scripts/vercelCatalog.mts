/**
 * HỎI VERCEL xem tài khoản nào đang giữ project nào — nửa CÓ MẠNG của việc tra đích.
 *
 * `deployTargets.mts` cố ý là phần THUẦN: nhận một danh mục project rồi ghép với sổ gương, kiểm
 * được mà không cần mạng. Nửa còn lại — đi hỏi từng token xem nó thấy những project gì — nằm ở
 * đây, tách riêng vì HAI công cụ cần nó: `deployAllStations` (phát hành cho mọi trạm) và
 * `removeMirrorStation` (xoá một trạm).
 *
 * Tách ra chứ không chép sang tệp thứ hai, và đó là luật đã trả giá ở `mongoSync` (xem
 * `src/lib/mongo/dbName.ts`): bản sao thứ hai luôn lệch bản thật vào đúng ngày nó được dùng lần
 * đầu. Phân trang, hạn giờ, và cách xử token hỏng phải giống hệt nhau ở cả hai chỗ — nếu không
 * thì công cụ xoá và công cụ phát hành sẽ bất đồng về việc「project này thuộc tài khoản nào」,
 * mà bất đồng ở đúng câu hỏi ấy nghĩa là xoá nhầm tài khoản.
 */
import type { ProjectRef, TokenSource } from "./deployTargets.mts";

/** Trần thời gian một lượt hỏi API. Phải trả lời tức thì hoặc là có chuyện. */
const API_TIMEOUT_MS = 30_000;
/** Trần số trang — chặn vòng lặp vô hạn nếu con trỏ phân trang hỏng. */
const MAX_PROJECT_PAGES = 20;

/**
 * Mọi project mà MỘT token nhìn thấy.
 *
 * Token ở đây được scope sẵn vào team của nó, nên `/v9/projects` (không kèm teamId) đã trả về
 * đúng project của tài khoản ấy, và `accountId` chính là `orgId` mà `.vercel/project.json` cần.
 *
 * KHÔNG ném khi token hỏng: một token hết hạn chỉ làm những trạm CỦA NÓ không tra được, và
 * người gọi sẽ báo「không tài khoản nào có project ấy」. Dòng cảnh báo là lời giải thích cho câu
 * ấy — không có nó thì một token bị thu hồi trông y hệt một trạm gõ sai tên.
 */
export async function projectsFor(source: TokenSource): Promise<ProjectRef[]> {
  const collected: ProjectRef[] = [];
  let until: number | undefined;

  for (let page = 0; page < MAX_PROJECT_PAGES; page++) {
    const url = new URL("https://api.vercel.com/v9/projects");
    url.searchParams.set("limit", "100");
    if (until !== undefined) url.searchParams.set("until", String(until));

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${source.token}` },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`  ⚠ ${source.envName}: liệt kê project hỏng — HTTP ${res.status}. Token hết hạn hay bị thu hồi?`);
      return collected;
    }
    const body = (await res.json()) as {
      projects?: { name?: string; id?: string; accountId?: string }[];
      pagination?: { next?: number | null };
    };
    for (const p of body.projects ?? []) {
      if (p.name && p.id && p.accountId) {
        collected.push({ name: p.name, projectId: p.id, orgId: p.accountId, envName: source.envName });
      }
    }
    const next = body.pagination?.next;
    if (next === null || next === undefined) return collected;
    until = next;
  }
  console.warn(`  ⚠ ${source.envName}: quá ${MAX_PROJECT_PAGES} trang project — dừng liệt kê ở đây.`);
  return collected;
}

/** Danh mục gộp của MỌI token đã khai — đầu vào của `resolveTarget`. */
export async function buildCatalog(tokens: readonly TokenSource[]): Promise<ProjectRef[]> {
  const perToken = await Promise.all(tokens.map((t) => projectsFor(t)));
  return perToken.flat();
}
