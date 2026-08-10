import { MongoClient, type Document } from "mongodb";
import { MONGO_SYSTEM_DBS, resolveMongoDbName } from "@/lib/mongo/dbName";

/**
 * Engine đồng bộ MongoDB giữa hai trạm — nửa còn lại của lượt chuyển trạm (pgSync.ts lo Postgres).
 *
 * Sảnh đàm đạo chỉ có hai collection và cả hai đều đơn giản, nên ở đây không cần bộ máy như
 * bên Postgres: không khoá ngoại, không sequence, không enum. Chỉ có một điều phải cẩn thận —
 * `_id` của Mongo là ObjectId, và một `insertMany` thẳng sẽ ném `E11000` ở lượt chạy lại. Nên
 * mỗi lô đi bằng `bulkWrite` với `replaceOne + upsert`: chạy lại bao nhiêu lần cũng ra một
 * kết quả, đúng luật idempotent mà cả máy trạng thái chuyển trạm dựa vào.
 *
 * Tên database KHÔNG lấy từ client mặc định mà giải bằng `resolveMongoDbName` — CHÍNH hàm mà
 * sảnh đàm đạo dùng để mở database của nó. Trước 10/08/2026 chỗ này có một bản luật riêng chỉ
 * đọc path của URI, và nó làm gãy lượt chuyển trạm đầu tiên: chuỗi Atlas không mang tên
 * database ở cuối bao giờ. Xem bình chú dài trong `src/lib/mongo/dbName.ts`.
 */

/** Đúng hai collection của sảnh đàm đạo — xem ghi chú đầu services/chat.ts. */
export const MONGO_COLLECTIONS = ["chat_messages", "chat_typing"] as const;
export type MongoCollection = (typeof MONGO_COLLECTIONS)[number];

/** Lô 500: document tin nhắn có thể mang cả đính kèm, nên nhỏ hơn lô Postgres một bậc. */
export const MONGO_BATCH = 500;

/** Trần chờ chọn server. Đây là một cú bấm trên trang admin, không phải phiên làm việc. */
const SERVER_SELECTION_MS = 10_000;

export type MongoSyncResult = {
  collection: MongoCollection;
  copied: number;
  srcCount: number;
  destCount: number;
  ok: boolean;
};

export type MongoSyncReport = {
  /** Tên database ĐÃ GIẢI của hai bên — trả ra để panel nói rõ nó vừa đụng vào đâu. */
  srcDb: string;
  destDb: string;
  collections: MongoSyncResult[];
};

/**
 * Tên database mỗi bên có thể chỉ đích danh; bỏ trống thì giải theo luật chung với
 * `MONGODB_DB` của TIẾN TRÌNH ĐANG CHẠY.
 *
 * Dùng chung một `MONGODB_DB` cho cả hai bên là đúng, nhưng chỉ đúng nhờ một điều kiện của
 * thiết kế: §9 của deploy/mirror/README.md buộc mọi trạm mang env GIỐNG NHAU trừ `SITE_ID`,
 * `DATABASE_URL`, `MONGODB_URI`. `MONGODB_DB` nay nằm trong bảng「phải giống nhau」ấy. Ngày
 * nào một trạm phá lệ thì truyền `destDb` vào đây, đừng sửa mặc định.
 */
export type MongoSyncOptions = { srcDb?: string | null; destDb?: string | null };

/**
 * Chốt chặn cho kiểu hỏng LẶNG LẼ nhất của bước này: nối đúng cụm, nhưng tên database sai.
 * Khi ấy nguồn đọc ra 0 document, đích nhận 0 document, `srcCount === destCount` — đối chiếu
 * xanh mướt và trạm gương lên ngôi với một sảnh đàm đạo trống trơn. Không phép kiểm nào ở
 * hạ nguồn bắt được, nên phải bắt ngay tại đây.
 *
 * Luật phân biệt: thiếu `chat_messages` ở database đã giải KHÔNG lập tức là lỗi — tông môn
 * chưa ai nhắn câu nào thì Mongo còn chưa tạo database. Chỉ là lỗi khi collection ấy đang
 * nằm ở MỘT database khác trên cùng cụm; lúc đó câu trả lời "trỏ nhầm chỗ" là chắc chắn, và
 * thông báo chỉ thẳng chỗ dữ liệu thật đang nằm.
 */
async function assertSourceDb(client: MongoClient, dbName: string): Promise<void> {
  const probe = MONGO_COLLECTIONS[0];
  if (await client.db(dbName).listCollections({ name: probe }).hasNext()) return;

  const { databases } = await client.db().admin().listDatabases({ nameOnly: true });
  const elsewhere: string[] = [];
  for (const entry of databases) {
    if (entry.name === dbName || MONGO_SYSTEM_DBS.has(entry.name)) continue;
    if (await client.db(entry.name).listCollections({ name: probe }).hasNext()) elsewhere.push(entry.name);
  }
  if (elsewhere.length > 0) {
    throw new Error(
      `Nguồn Mongo đang trỏ database「${dbName}」nhưng ở đó không có ${probe}; ` +
        `sảnh đàm đạo thật nằm ở ${elsewhere.map((n) => `「${n}」`).join(", ")}. ` +
        `Đặt MONGODB_DB cho khớp rồi chạy lại — chép tiếp là chép một sảnh rỗng đè lên trạm đích.`,
    );
  }
  // Không database nào trên cụm có collection ấy: tông môn chưa có tin nhắn. Chép rỗng là đúng.
}

/**
 * Chép trọn hai collection từ nguồn sang đích và đối chiếu số lượng.
 *
 * Chạy TRỌN trong một lượt gọi (khác Postgres chia trang): sảnh đàm đạo giữ tin theo hạn lưu
 * (mặc định 14 ngày) nên khối lượng ở đây nhỏ hơn `job_events` nhiều bậc. Ngày nào nó lớn tới
 * mức chạm trần thời gian thì chia lô theo `_id` như bên kia — nhưng đừng dựng sẵn bộ máy ấy
 * cho một bài toán chưa có.
 *
 * Hai client đóng trong `finally`: một agent còn mở giữ event loop sống, và script kiểm chứng
 * sẽ treo thay vì thoát (cùng bài học với `closeChatStore()`).
 */
export async function syncMongo(
  srcUri: string,
  destUri: string,
  opts: MongoSyncOptions = {},
): Promise<MongoSyncReport> {
  const srcName = resolveMongoDbName(srcUri, opts.srcDb ?? process.env.MONGODB_DB);
  const destName = resolveMongoDbName(destUri, opts.destDb ?? process.env.MONGODB_DB);

  const src = new MongoClient(srcUri, { serverSelectionTimeoutMS: SERVER_SELECTION_MS });
  const dest = new MongoClient(destUri, { serverSelectionTimeoutMS: SERVER_SELECTION_MS });
  try {
    await Promise.all([src.connect(), dest.connect()]);
    await assertSourceDb(src, srcName);
    const srcDb = src.db(srcName);
    const destDb = dest.db(destName);
    const results: MongoSyncResult[] = [];

    for (const name of MONGO_COLLECTIONS) {
      const from = srcDb.collection<Document>(name);
      const to = destDb.collection<Document>(name);

      // Xoá trước rồi chép: đích phải khớp nguồn TỪNG document, kể cả những tin đã bị thu hồi
      // bên nguồn. Chỉ upsert thôi thì rác của lượt trước nằm lại vĩnh viễn.
      await to.deleteMany({});

      let copied = 0;
      const cursor = from.find({}, { batchSize: MONGO_BATCH });
      let batch: Document[] = [];
      const flush = async () => {
        if (batch.length === 0) return;
        await to.bulkWrite(
          batch.map((doc) => ({
            replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true },
          })),
          { ordered: false },
        );
        copied += batch.length;
        batch = [];
      };
      for await (const doc of cursor) {
        batch.push(doc);
        if (batch.length >= MONGO_BATCH) await flush();
      }
      await flush();

      const [srcCount, destCount] = [await from.countDocuments(), await to.countDocuments()];
      results.push({ collection: name, copied, srcCount, destCount, ok: srcCount === destCount });
    }

    return { srcDb: srcName, destDb: destName, collections: results };
  } finally {
    await Promise.allSettled([src.close(), dest.close()]);
  }
}
