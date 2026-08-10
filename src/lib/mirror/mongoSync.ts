import { MongoClient, type Document } from "mongodb";

/**
 * Engine đồng bộ MongoDB giữa hai trạm — nửa còn lại của lượt chuyển trạm (pgSync.ts lo Postgres).
 *
 * Sảnh đàm đạo chỉ có hai collection và cả hai đều đơn giản, nên ở đây không cần bộ máy như
 * bên Postgres: không khoá ngoại, không sequence, không enum. Chỉ có một điều phải cẩn thận —
 * `_id` của Mongo là ObjectId, và một `insertMany` thẳng sẽ ném `E11000` ở lượt chạy lại. Nên
 * mỗi lô đi bằng `bulkWrite` với `replaceOne + upsert`: chạy lại bao nhiêu lần cũng ra một
 * kết quả, đúng luật idempotent mà cả máy trạng thái chuyển trạm dựa vào.
 *
 * Tên database KHÔNG lấy từ client mặc định mà đọc từ path của URI (giống `databaseName` bên
 * services/chat.ts): hai trạm có thể đặt tên database khác nhau trong cùng một cụm.
 */

/** Đúng hai collection của sảnh đàm đạo — xem ghi chú đầu services/chat.ts. */
export const MONGO_COLLECTIONS = ["chat_messages", "chat_typing"] as const;
export type MongoCollection = (typeof MONGO_COLLECTIONS)[number];

/** Lô 500: document tin nhắn có thể mang cả đính kèm, nên nhỏ hơn lô Postgres một bậc. */
export const MONGO_BATCH = 500;

/** Trần chờ chọn server. Đây là một cú bấm trên trang admin, không phải phiên làm việc. */
const SERVER_SELECTION_MS = 10_000;

function databaseName(uri: string): string {
  const path = new URL(uri.replace(/^mongodb(\+srv)?:/, "http:")).pathname.replace(/^\//, "");
  const name = path.split("?")[0];
  if (!name) throw new Error("MONGODB_URI thiếu tên database ở cuối đường dẫn.");
  return name;
}

export type MongoSyncResult = {
  collection: MongoCollection;
  copied: number;
  srcCount: number;
  destCount: number;
  ok: boolean;
};

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
export async function syncMongo(srcUri: string, destUri: string): Promise<MongoSyncResult[]> {
  const src = new MongoClient(srcUri, { serverSelectionTimeoutMS: SERVER_SELECTION_MS });
  const dest = new MongoClient(destUri, { serverSelectionTimeoutMS: SERVER_SELECTION_MS });
  try {
    await Promise.all([src.connect(), dest.connect()]);
    const srcDb = src.db(databaseName(srcUri));
    const destDb = dest.db(databaseName(destUri));
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

    return results;
  } finally {
    await Promise.allSettled([src.close(), dest.close()]);
  }
}
