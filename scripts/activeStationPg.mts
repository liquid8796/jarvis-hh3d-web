/**
 * TRA CHUỖI KẾT NỐI CỦA TRẠM ĐANG HOẠT ĐỘNG, chịu được chuyện sổ dưới máy đã cũ.
 *
 * VÌ SAO LÀ MỘT MÔ-ĐUN RIÊNG: sổ có thẩm quyền nằm ở trạm ĐANG HOẠT ĐỘNG, không phải ở chỗ
 * `DATABASE_URL` dưới máy trỏ tới — mà `.env.local` thì trỏ cứng vào `main`, trạm đã nghỉ từ
 * 10/08/2026. Mọi script ghi sổ đều phải đi qua đúng phép tra này, và một bản chép thứ hai là
 * hẹn ngày một script ghi vào trạm đã nghỉ: một lượt hỏng KHÔNG để lại dấu vết nào — nó nối
 * được, đọc ra dữ liệu thật, chỉ là dữ liệu của một trạm không ai dùng nữa.
 *
 * `newMirrorStation.mts` dừng hẳn khi sổ dưới máy thiếu trạm hoạt động. Ở đây đi thêm một bước,
 * vì cảnh ấy là cảnh THƯỜNG chứ không hiếm: sổ của `main` đóng băng đúng ngày nó nghỉ và không
 * bao giờ biết những trạm sinh sau. Đo 12/08/2026: sổ dưới máy có 2 trạm, sổ ở trạm hoạt động có
 * 4. Sổ đi theo mọi lượt đồng bộ nên trạm nào còn sống cũng biết đường chỉ tiếp — hỏi lần lượt
 * tới khi ra.
 */
import { neon } from "@neondatabase/serverless";
import { decryptSecret } from "../src/lib/crypto/secretBox";

type Mirror = { id: string; pg?: string };

async function readMirrors(url: string): Promise<Mirror[]> {
  const rows = (await neon(url)`select value->'mirrors' as mirrors from app_settings where id = 'global'`) as {
    mirrors: Mirror[] | null;
  }[];
  return rows[0]?.mirrors ?? [];
}

/**
 * Chuỗi kết nối Postgres của `activeSiteId`, tra qua sổ dưới máy rồi qua sổ của từng trạm còn
 * đọc được. NÉM khi hết đường — người gọi bắt rồi đổi thành lời từ chối của riêng nó (mỗi script
 * có một lớp `Stop`/`DungLai` riêng, và ném ở đây thì không script nào phải nhập của script kia).
 *
 * `onFallback` để người gọi kể lại đường vòng đã đi. Im lặng đi vòng cũng ra kết quả đúng, nhưng
 * nó giấu mất dấu hiệu「sổ dưới máy đã cũ」— thứ đáng biết trước khi nó gây chuyện ở một lượt khác.
 */
export async function resolveActiveStationPg(input: {
  localDatabaseUrl: string;
  activeSiteId: string;
  onFallback?: (viaSiteId: string) => void;
}): Promise<string> {
  const { localDatabaseUrl, activeSiteId } = input;

  const local = await readMirrors(localDatabaseUrl);
  const direct = local.find((m) => m.id === activeSiteId);
  if (direct?.pg) return decryptSecret(direct.pg);

  for (const station of local) {
    if (!station.pg) continue;
    try {
      const found = (await readMirrors(decryptSecret(station.pg))).find((m) => m.id === activeSiteId);
      if (found?.pg) {
        input.onFallback?.(station.id);
        return decryptSecret(found.pg);
      }
    } catch {
      // Trạm không nối được thì hỏi trạm kế. Một trạm chết không được phép chặn cả lượt chạy.
    }
  }

  throw new Error(
    `Không tra ra chuỗi kết nối của trạm đang hoạt động「${activeSiteId}」.\n` +
      "  Vào trang Tông Môn → Gương Trạm trên trạm ấy, bấm「Ghi trạm này vào sổ」rồi chạy lại.",
  );
}
