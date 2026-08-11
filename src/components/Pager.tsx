"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Phân trang dùng chung cho các bảng dài — sổ môn đồ và hàng đợi.
 *
 * CẮT Ở CLIENT chứ không LIMIT/OFFSET ở server, và đây là một lựa chọn có điều kiện chứ không
 * phải lười: cả hai danh sách vốn đã nằm trọn trong client (sổ môn đồ đi vào bằng prop từ
 * server component; hàng đợi giữ một ảnh chụp tự làm mới theo nhịp SSE + poll). Đổi sang phân
 * trang phía server sẽ bắt hàng đợi hỏi lại server mỗi lần bấm sang trang, đúng lúc nó đang có
 * một kênh trực tiếp làm việc ấy hộ rồi — hai nguồn cùng ghi vào một danh sách là cách nhanh
 * nhất để số trên màn hình nhảy loạn. Sổ môn đồ thì 26 dòng: một câu LIMIT cho ngần ấy dòng là
 * bắt cả một vòng round-trip trả giá cho việc cắt một mảng.
 *
 * NGÀY NÀO danh sách đủ lớn để tải trọn gói là gánh nặng thật, chỗ phải sửa là `listUsers` và
 * `getQueueSnapshot` — không phải tệp này.
 */

/** Các mức cho người dùng chọn. Có 100 vì sổ môn đồ hiện chỉ 26 dòng — ai muốn xem trọn một mạch. */
export const PAGE_SIZES = [10, 20, 50, 100] as const;

/** Mặc định khi chưa ai chọn gì, và cũng là bản vẽ ở LƯỢT ĐẦU trước khi đọc được lựa chọn cũ. */
export const DEFAULT_PAGE_SIZE = 20;

const isPageSize = (value: unknown): value is number =>
  typeof value === "number" && (PAGE_SIZES as readonly number[]).includes(value);

/**
 * Số dòng mỗi trang, nhớ qua các lần mở lại.
 *
 * Đọc trong effect chứ không lúc render: `localStorage` chỉ có ở trình duyệt, đọc lúc render thì
 * bản dựng ở server và bản ở máy khách khác nhau và React kêu lệch hydrate — cùng bài học đã ghi
 * ở ChatPicker. Cái giá là lượt vẽ đầu tiên dùng mức mặc định rồi mới đổi; chấp nhận được, vì
 * thứ đổi chỉ là số dòng chứ không phải nội dung.
 *
 * @param storageKey khoá riêng cho từng bảng, để sổ môn đồ và hàng đợi không giẫm lên nhau
 */
export function usePageSize(storageKey: string): [number, (next: number) => void] {
  const [perPage, setPerPage] = useState<number>(DEFAULT_PAGE_SIZE);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      const parsed = raw === null ? null : Number(raw);
      // Chỉ nhận đúng những mức đang có trong danh sách: giá trị lạ (bản cũ để lại, hay ai đó
      // sửa tay trong DevTools) mà lọt vào thì ô chọn hiện một mục không tồn tại và bảng cắt
      // theo một con số không ai chọn được nữa.
      if (isPageSize(parsed)) setPerPage(parsed);
    } catch {
      // localStorage bị chặn (chế độ riêng tư): dùng mặc định, không có gì để cứu và cũng
      // không có gì hỏng.
    }
  }, [storageKey]);

  const choose = useCallback(
    (next: number) => {
      if (!isPageSize(next)) return;
      setPerPage(next);
      try {
        window.localStorage.setItem(storageKey, String(next));
      } catch {
        // Không ghi được thì lựa chọn vẫn đúng trong phiên này, chỉ không sống qua lần sau.
      }
    },
    [storageKey],
  );

  return [perPage, choose];
}

export type Paged<T> = {
  /** Đúng phần của trang hiện tại. */
  items: T[];
  page: number;
  pages: number;
  total: number;
  /** Thứ tự dòng đầu/cuối đang hiện, đếm từ 1. Cả hai bằng 0 khi danh sách rỗng. */
  from: number;
  to: number;
  setPage: (page: number) => void;
};

/**
 * Cắt một mảng thành trang.
 *
 * KHÔNG tự về trang 1 khi `items` đổi. Hàng đợi thay mảng mới sau MỖI nhịp poll (~vài giây):
 * về trang 1 mỗi nhịp thì không ai đọc nổi trang 2. Đổi bộ lọc thì mới cần về đầu, và đó là
 * việc của nơi gọi — nó mới biết thế nào là "bộ lọc đã đổi".
 *
 * Nhưng trang HIỆN TẠI thì phải luôn nằm trong tầm: một đàn rời hàng đợi hay một đạo hữu bị
 * trục xuất có thể xoá hẳn trang cuối, và một trang vượt tầm hiện ra thành bảng trống trơn
 * trong khi dữ liệu vẫn còn nguyên. Nên vừa KẸP lúc tính, vừa sửa lại state ngay sau đó — kẹp
 * thôi thì lượt bấm kế tiếp vẫn tính từ con số cũ đã sai.
 */
export function usePaged<T>(items: readonly T[], perPage: number): Paged<T> {
  const [page, setPage] = useState(1);

  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const safePage = Math.min(Math.max(1, page), pages);

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  // Đổi số dòng mỗi trang thì về đầu. Cách khác là cố giữ dòng đang xem ở lại trong tầm nhìn,
  // nhưng "trang 3 khi mỗi trang 10 dòng" thành "trang 1,2 khi mỗi trang 25" là một con số
  // không có thật — về đầu thì đoán được, và đoán được quan trọng hơn khéo.
  useEffect(() => {
    setPage(1);
  }, [perPage]);

  const start = (safePage - 1) * perPage;
  const slice = items.slice(start, start + perPage);

  return {
    items: slice,
    page: safePage,
    pages,
    total,
    from: total === 0 ? 0 : start + 1,
    to: total === 0 ? 0 : start + slice.length,
    setPage,
  };
}

/**
 * Ô chọn số dòng, đứng RIÊNG để đặt ở góc phải hàng công cụ TRÊN bảng (yêu cầu 11/08/2026).
 *
 * Vì sao tách khỏi thanh dưới chứ không chỉ đổi thứ tự: nó không cùng loại với hai thứ kia.
 * Tóm tắt và nút lùi/tới nói về TRẠNG THÁI của lượt xem hiện tại — có gì để điều thì mới hiện;
 * còn đây là một TUỲ CHỌN của người xem, sống độc lập với việc bảng đang có bao nhiêu dòng.
 * Vì thế nó cũng KHÔNG tự ẩn khi danh sách rỗng: một cái nút chỉnh mà lúc ẩn lúc hiện thì
 * người dùng phải đi tìm, còn một cái nút luôn ở đúng chỗ thì không.
 *
 * Ở Hàng Đợi nó còn giải quyết một chuyện thật: hai tab dùng CHUNG một mức, mà trước đây mỗi
 * tab tự vẽ một ô — cùng một thứ vẽ hai lần. Đặt cạnh hàng tab thì chỉ còn đúng một cái.
 */
export function PageSizeSelect({
  perPage,
  onPerPage,
  /** Danh từ đếm được — chỉ dùng cho nhãn trợ năng, vì trên màn hình đã có chữ「Mỗi trang」. */
  unit,
}: {
  perPage: number;
  onPerPage: (next: number) => void;
  unit: string;
}) {
  return (
    /* `whitespace-nowrap`: hàng công cụ là flex-wrap, nên khi chỗ hẹp đi thì nhãn bị bóp cho
       gãy làm hai dòng ("Mỗi" / "trang") trong khi cả hàng vẫn còn thừa chỗ để XUỐNG DÒNG
       nguyên cụm — thà rơi cả cụm xuống dòng dưới còn hơn vỡ một chữ làm đôi. */
    <label className="flex items-center gap-2 whitespace-nowrap text-sm text-[var(--color-mist)]">
      <span>Mỗi trang</span>
      {/* `max-w-*` chứ KHÔNG `w-auto`: `.input` khai `width: 100%` và nó nằm NGOÀI mọi
          `@layer`, nên nó thắng mọi utility bề rộng của Tailwind (style không-layer luôn
          thắng style trong layer, bất kể specificity hay thứ tự). Kẹp trần thì không phải
          cãi nhau với luật ấy — cùng cách `input max-w-xs` ở bảng môn đồ đang làm. */}
      <select
        className="input max-w-[5.5rem] py-1"
        aria-label={`Số ${unit} mỗi trang`}
        value={perPage}
        onChange={(e) => onPerPage(Number(e.target.value))}
      >
        {PAGE_SIZES.map((size) => (
          <option key={size} value={size}>
            {size}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Thanh DƯỚI bảng: một câu tóm tắt, và cụm lùi/tới khi thật sự có hơn một trang.
 *
 * Ô chọn số dòng KHÔNG còn ở đây — nó lên hàng công cụ trên bảng, xem `PageSizeSelect`. Cả
 * thanh này tự ẩn khi danh sách rỗng, vì lúc ấy không có gì để tóm tắt và cũng không có gì để
 * điều; câu「không tìm thấy」của chính bảng đã nói đủ.
 */
export function Pager({
  paged,
  /** Danh từ đếm được, để câu tóm tắt đọc như tiếng người: "12 trong 26 đạo hữu". */
  unit,
}: {
  paged: Paged<unknown>;
  unit: string;
}) {
  const { page, pages, total, from, to } = paged;
  if (total === 0) return null;

  return (
    <nav
      aria-label={`Điều trang danh sách ${unit}`}
      className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-[var(--color-mist)]"
    >
      {/* `aria-live` để trình đọc màn hình nghe được kết quả của cú bấm — nút "Sau" tự nó không
          nói ra là đã sang trang nào. `polite` chứ không `assertive`: đây là tin báo, không
          phải báo động. */}
      <span aria-live="polite">
        {from}–{to} trong {total} {unit}
      </span>

      {pages > 1 && (
        <span className="ml-auto flex items-center gap-2">
          <button
            type="button"
            className="btn btn-ghost px-2.5 py-1 text-xs"
            onClick={() => paged.setPage(page - 1)}
            disabled={page <= 1}
          >
            ← Trước
          </button>
          <span className="text-xs">
            Trang {page}/{pages}
          </span>
          <button
            type="button"
            className="btn btn-ghost px-2.5 py-1 text-xs"
            onClick={() => paged.setPage(page + 1)}
            disabled={page >= pages}
          >
            Sau →
          </button>
        </span>
      )}
    </nav>
  );
}
