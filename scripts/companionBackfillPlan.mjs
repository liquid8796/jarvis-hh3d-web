/**
 * Luật THUẦN cho lượt bù kho phụ — không mạng, không `gh`, không database.
 *
 * Bù kho phụ khác lượt dựng bundle mới ở đúng một chỗ, và chỗ ấy là cả lý do tệp này tồn tại:
 * một bundle mới luôn dựng ĐỦ hai kho phụ trong một giao dịch, còn ở đây mỗi trạm đã sẵn có 0, 1
 * hoặc 2 kho phụ và ta chỉ chạm vào phần CÒN THIẾU. Trạm đủ hai thì bỏ qua; trạm có một thì chỉ
 * thêm một, giữ nguyên cái cũ. Ba quyết định「thiếu mấy cái」,「tránh tên nào」,「giữ lại cái nào」
 * là logic thuần — tách ra đây để `verify:companion-backfill` đóng đinh nó mà không cần một byte
 * mạng nào.
 *
 * Là `.mjs` cùng lối với `companionProject.mjs`: builder chạy bằng Node thuần import được, mà cửa
 * điều phối chạy bằng `tsx` cũng import được — một nguồn luật, không hai bản trôi khỏi nhau.
 */
import { COMPANION_REPO_COUNT } from "./companionProject.mjs";

export { COMPANION_REPO_COUNT };

/**
 * Một dòng kho phụ RỖNG, đúng hình dạng `githubCompanionRepoSchema` (services/settings.ts) chờ và
 * đúng bản mà `newGithubStation.mts` ghi cho kho mới.
 *
 * Mọi trường quan sát để trống có chủ ý: `lastNurtureDay: null` nghĩa là「vòng nuôi chưa chạm」,
 * nên lượt cron kế nhận ra nó tới hạn và đẩy commit đầu tiên. Script này KHÔNG giả vờ đã nuôi —
 * nó chỉ mở ra một chỗ trống đúng khuôn để vòng nuôi tự lấp.
 */
export function emptyCompanionEntry(repo) {
  return {
    repo,
    lastNurtureDay: null,
    pushesToday: 0,
    lastPushAt: null,
    lastPushOk: null,
    lastPushNote: "",
  };
}

/**
 * Số kho phụ CÒN THIẾU của một trạm: 0 (đủ), 1, hoặc 2.
 *
 * Kẹp dưới ở 0 để dữ liệu rác (một trạm lỡ mang ba dòng) không sinh ra một số âm rồi kéo cả phép
 * cộng đi lạc. `companionRepos` vắng hẳn (station đời rất cũ) đọc thành 0 dòng → thiếu đủ hai.
 */
export function deficitOf(station) {
  const have = Array.isArray(station?.companionRepos) ? station.companionRepos.length : 0;
  return Math.max(0, COMPANION_REPO_COUNT - have);
}

/**
 * Mọi cái tên mà một kho phụ MỚI của trạm này không được trùng — tất cả hạ về chữ thường.
 *
 * Va chạm tên chỉ có nghĩa TRONG cùng một tài khoản (repo của GitHub gắn theo owner), nên chỉ cần
 * tránh những tên của CHÍNH trạm này: kho khôi lỗi chính, `WORKER_ID` (thường trùng tên kho chính
 * nhưng không bắt buộc), và những kho phụ đã có. Cửa điều phối còn probe tồn tại thật trên GitHub
 * làm hàng rào cuối — đây chỉ là lượt loại sớm cho rẻ, để bộ sinh tên khỏi trả về một cái tên đã
 * dùng ngay trong chính trạm ấy.
 */
export function avoidNamesFor(station) {
  const names = [];
  if (typeof station?.repo === "string" && station.repo) names.push(station.repo.toLowerCase());
  if (typeof station?.workerId === "string" && station.workerId) names.push(station.workerId.toLowerCase());
  for (const companion of Array.isArray(station?.companionRepos) ? station.companionRepos : []) {
    if (typeof companion?.repo === "string" && companion.repo) names.push(companion.repo.toLowerCase());
  }
  return [...new Set(names)];
}

/**
 * Chia sổ thành「phải bù」và「bỏ qua」, tôn trọng cờ `--repo` nếu có.
 *
 * `onlyRepo` khớp theo TÊN KHO (đoạn cuối slug), không phân biệt hoa thường — cùng lối với
 * `github:deploy --repo` và `github:revive --repo`. Truyền một tên KHÔNG có trong sổ là lỗi cấu
 * hình của người gọi, không phải「không có gì để làm」: trả `error` để cửa điều phối dừng thẳng,
 * thay vì lặng lẽ chạy suông rồi báo「đã bù 0 kho」như thể mọi thứ đều ổn.
 *
 * `skipped` mang theo lý do vì bảng tổng kết phải phân biệt được「đã đủ hai」với「không nằm trong
 * --repo」— hai câu trả lời khác nhau cho cùng câu hỏi「sao kho này không bị đụng tới」.
 *
 * @param {readonly any[]} stations  Sổ Kho GitHub (settings.githubStations).
 * @param {string | null} [onlyRepo] Tên kho duy nhất cần xét, hoặc null cho toàn sổ.
 * @returns {{ targets: Array<{slug:string, station:any, need:number, avoid:string[]}>,
 *            skipped: Array<{slug:string, reason:string}>, error: string | null }}
 */
export function planStations(stations, onlyRepo = null) {
  const list = Array.isArray(stations) ? stations : [];
  const wanted = onlyRepo ? String(onlyRepo).toLowerCase() : null;

  if (wanted && !list.some((s) => String(s?.repo ?? "").toLowerCase() === wanted)) {
    return {
      targets: [],
      skipped: [],
      error: `Không có kho「${onlyRepo}」trong sổ Kho GitHub. Bỏ --repo để xét mọi kho.`,
    };
  }

  const targets = [];
  const skipped = [];
  for (const station of list) {
    const slug = `${station?.owner ?? "?"}/${station?.repo ?? "?"}`;
    if (wanted && String(station?.repo ?? "").toLowerCase() !== wanted) {
      skipped.push({ slug, reason: "không nằm trong --repo" });
      continue;
    }
    const need = deficitOf(station);
    if (need === 0) {
      skipped.push({ slug, reason: "đã đủ hai kho phụ" });
      continue;
    }
    targets.push({ slug, station, need, avoid: avoidNamesFor(station) });
  }
  return { targets, skipped, error: null };
}

/**
 * Gộp những kho phụ VỪA TẠO vào các dòng cũ, theo đúng luật schema: giữ cái cũ ở trước, và TỐI ĐA
 * hai.
 *
 * Phép kẹp về hai KHÔNG phải phòng xa thừa: `appSettingsSchema` dùng `.catch([])` cho cả cụm
 * githubStations, nên một mảng `companionRepos` dài ba phần tử không văng riêng nó ra — nó kéo CẢ
 * sổ Kho GitHub về rỗng ở lượt đọc kế. Thà bỏ một tên vừa tạo (rồi báo để người vận hành xoá tay)
 * còn hơn nuốt sạch sổ. Trả về mảng mới, không sửa tại chỗ.
 */
export function withCreatedCompanions(existing, createdRepoNames) {
  const base = Array.isArray(existing) ? existing : [];
  const additions = (Array.isArray(createdRepoNames) ? createdRepoNames : []).map(emptyCompanionEntry);
  return [...base, ...additions].slice(0, COMPANION_REPO_COUNT);
}
