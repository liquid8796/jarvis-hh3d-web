/**
 * Cổng điều phối TOÀN CỤC cho nhiệm vụ — một bộ đếm cho cả tiến trình khôi lỗi, xuyên mọi
 * đàn và mọi đạo hữu mà khôi lỗi ấy đang phục vụ.
 *
 * Vì sao tồn tại: nhật ký 07/08 01:03:55. Hoang Vực (trang riêng /hoang-vuc) chạy song song
 * cạnh một trận Mê Cung đủ đội (trang riêng /me-cung) trên VM hai nhân — hoạt ảnh của tab bị
 * bỏ đói CPU chưa chạy xong thì ngân sách bằng chứng đã cạn, và một đòn đánh thật sự trúng
 * bị báo thành thất bại. Nới ngân sách (0.34.1) là thuốc giảm đau; thuốc chữa là đừng bao
 * giờ để hai trận đánh lớn giành nhau hai nhân CPU nữa.
 *
 * Luật, đúng theo lời tông chủ đặt ra:
 *   - Nhiệm vụ HUB (pagePath = dailyQuestPath, các thao tác ngắn trên /nhiem-vu-hang-ngay):
 *     chạy song song tự do như trước — trần tab mỗi đàn vẫn do pool của vòng đó giữ.
 *   - Nhiệm vụ TRANG RIÊNG (pagePath khác): cả tiến trình chỉ MỘT cái tại một thời điểm,
 *     và khi nó chạy, tối đa MỘT nhiệm vụ hub được làm bạn đồng hành — tổng ≤ 2 nhiệm vụ
 *     đang chạy, kể cả của đạo hữu khác.
 *
 * Hai nhiệm vụ trang riêng KHÔNG được cặp với nhau, dù "mỗi cái chỉ thấy 1 cái khác" nghe
 * như thoả luật: cặp Mê Cung + Hoang Vực chính là sự cố sinh ra luật này, và mục đích được
 * tuyên bố là "đảm bảo resource cho các quest dài và phức tạp" — hai con quái vật chia nhau
 * hai nhân CPU thì chẳng con nào được đảm bảo gì.
 *
 * Công bằng: hàng đợi FIFO với một ngoại lệ có chủ ý. Nhiệm vụ trang riêng đứng đợi thì hub
 * mới KHÔNG được chen ngang (để số đang chạy rút về ≤ 1 và nó được vào — không có luật này,
 * dòng hub bất tận của các đàn khác bỏ đói nó vĩnh viễn). Nhưng khi trang riêng ĐÃ chạy,
 * hub phía sau được phép vượt lên lấp chỗ đồng hành còn trống — chỗ ấy để không thì không
 * ai được gì, và trang riêng kế tiếp không mất lượt: nó chỉ chờ đúng người đang giữ cổng.
 *
 * Chờ HUỶ ĐƯỢC: Thu Đàn giữa lúc xếp hàng không được phép kẹt lại sau một trận Mê Cung 35
 * phút của người khác chỉ để nói "tôi dừng đây". Mỗi waiter mang shouldStop của vòng nó;
 * một nhịp poll 500ms (chỉ chạy khi hàng đợi có người) nhặt những waiter đã rút lui.
 *
 * Module-level state là CHỦ Ý, không phải tiện tay: worker chạy nhiều đàn trong cùng một
 * tiến trình Node, nên một bộ đếm mức module chính là "toàn cục trên cái máy này" — đúng
 * phạm vi tài nguyên (CPU) mà luật muốn bảo vệ. Hai khôi lỗi trên hai máy khác nhau không
 * cần biết nhau.
 */

/** Nhiệm vụ có trang riêng — đối tượng của luật nhường đường. */
export function isDedicatedPageQuest(profile, quest) {
  return Boolean(quest.pagePath) && quest.pagePath !== profile.dailyQuestPath;
}

const state = {
  /** Tổng nhiệm vụ đang chạy qua cổng, mọi đàn cộng lại. */
  active: 0,
  /** 0 hoặc 1 — bất biến của cả module. */
  dedicatedActive: 0,
  /** Tên nhiệm vụ trang riêng đang giữ cổng, cho lời nhật ký của kẻ phải đợi. */
  dedicatedName: null,
  /** FIFO: { dedicated, name, shouldStop, resolve } */
  queue: [],
  pollTimer: null,
};

/** Hook cho smoke test: được gọi đồng bộ sau MỖI lần admit/release với ảnh chụp state. */
let onChange = null;
export function _observeGate(fn) {
  onChange = fn;
}
/** Cũng cho smoke: đưa cổng về trắng giữa hai kịch bản, vì state sống mức module. */
export function _resetGate() {
  for (const w of state.queue.splice(0)) w.resolve({ aborted: true });
  state.active = 0;
  state.dedicatedActive = 0;
  state.dedicatedName = null;
  stopPollIfIdle();
}

function snapshot() {
  return {
    active: state.active,
    dedicatedActive: state.dedicatedActive,
    queued: state.queue.length,
  };
}

function notifyChange() {
  onChange?.(snapshot());
}

function canAdmit(dedicated, hasDedicatedAhead) {
  if (dedicated) {
    // Vào xong tổng ≤ 2 và là trang-riêng duy nhất; không vượt mặt trang-riêng xếp trước.
    return state.dedicatedActive === 0 && state.active <= 1 && !hasDedicatedAhead;
  }
  if (state.dedicatedActive === 1) {
    return state.active < 2; // chỗ đồng hành duy nhất
  }
  // Không trang-riêng nào đang chạy: hub tự do — trừ khi có trang-riêng đứng đợi phía
  // trước, lúc ấy hub mới phải nhường cho cổng rút về ≤ 1.
  return !hasDedicatedAhead;
}

function admit(waiter) {
  state.active += 1;
  if (waiter.dedicated) {
    state.dedicatedActive = 1;
    state.dedicatedName = waiter.name;
  }
  notifyChange();

  let released = false;
  return {
    release() {
      if (released) return; // release hai lần không được phép đánh sập bộ đếm
      released = true;
      state.active -= 1;
      if (waiter.dedicated) {
        state.dedicatedActive = 0;
        state.dedicatedName = null;
      }
      notifyChange();
      drain();
    },
  };
}

function drain() {
  let hasDedicatedAhead = false;
  for (let i = 0; i < state.queue.length; ) {
    const waiter = state.queue[i];

    if (waiter.shouldStop?.()) {
      // Thu Đàn giữa lúc xếp hàng: rút lui tại chỗ, không chiếm slot nào.
      state.queue.splice(i, 1);
      waiter.resolve({ aborted: true });
      continue;
    }

    if (canAdmit(waiter.dedicated, hasDedicatedAhead)) {
      state.queue.splice(i, 1);
      waiter.resolve(admit(waiter));
      continue; // cùng chỉ số i giờ là waiter kế tiếp
    }

    if (waiter.dedicated) hasDedicatedAhead = true;
    i += 1;
  }
  stopPollIfIdle();
}

function stopPollIfIdle() {
  if (state.queue.length === 0 && state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

/**
 * Xin một chỗ chạy. Trả về `{ release }` khi tới lượt, hoặc `{ aborted: true }` nếu vòng đã
 * Thu Đàn trong lúc xếp hàng. `release()` PHẢI được gọi trong finally của người xin — một
 * slot rò rỉ là cả tiến trình nghẽn vĩnh viễn, nên release được làm trơ với gọi trùng.
 *
 * @param {object} input
 * @param {boolean} input.dedicated  nhiệm vụ trang riêng?
 * @param {string}  input.name       tên cho nhật ký của người khác
 * @param {() => boolean} [input.shouldStop]  cờ Thu Đàn của vòng đang xin
 * @param {(info: { holder: string | null }) => void} [input.onWait]  gọi MỘT lần nếu phải xếp hàng
 */
export function acquireQuestSlot({ dedicated, name, shouldStop, onWait }) {
  if (state.queue.length === 0 && canAdmit(dedicated, false)) {
    return Promise.resolve(admit({ dedicated, name }));
  }

  return new Promise((resolve) => {
    const waiter = { dedicated, name, shouldStop, resolve };
    state.queue.push(waiter);

    // Drain NGAY khi vừa xếp hàng, không đợi ai buông cổng: một hub tới lúc chỗ đồng hành
    // còn trống phải được vào trong cùng nhịp — nhịp poll 500ms chỉ dành cho việc nhặt
    // waiter đã Thu Đàn, không phải con đường nhập cuộc bình thường.
    drain();

    if (state.queue.includes(waiter)) {
      // Vẫn đứng trong hàng sau lượt drain → giờ mới thật sự là "xếp hàng chờ".
      onWait?.({ holder: state.dedicatedName });
      if (!state.pollTimer) {
        // unref để một hàng đợi đang chờ không giữ tiến trình sống khi mọi thứ khác đã
        // xong (script thoát tự nhiên).
        state.pollTimer = setInterval(drain, 500);
        state.pollTimer.unref?.();
      }
    }
  });
}
