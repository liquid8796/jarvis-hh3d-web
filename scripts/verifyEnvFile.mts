/**
 * Kiểm chứng phép ĐỌC và phép VÁ tệp .env (`scripts/envFile.mts`).
 *
 * Thuần từ đầu tới cuối: không đĩa, không mạng, không database. Đây là chỗ đáng kiểm nhất của cả
 * lượt đồng bộ — nó ghi đè `.env.local`, tệp giữ chìa OCI, chìa Vercel của từng tài khoản,
 * `ENCRYPTION_KEY` và token khôi lỗi. Một phép vá sai ở đây không làm hỏng một tính năng, nó làm
 * hỏng cả cái máy.
 */
import { formatEnvValue, mergeEnvFile, parseEnvFile } from "./envFile.mts";

let passed = 0;
const ok = (cond: boolean, what: string) => {
  if (!cond) {
    console.error(`\n✗ ${what}`);
    process.exit(1);
  }
  passed += 1;
  console.log(`✔ ${what}`);
};

const map = (o: Record<string, string>) => new Map(Object.entries(o));

// ---- Đọc: phải khớp TỪNG BƯỚC với loadEnv.mjs ------------------------------------------------
{
  const parsed = parseEnvFile(
    ['A=1', 'B="hai"', "C='ba'", "# D=bo-qua", "", "   ", "E = co khoang trang ", "=khong-co-khoa"].join("\n"),
  );
  ok(parsed.get("A") === "1", "gán trần trụi");
  ok(parsed.get("B") === "hai", "bóc nháy kép");
  ok(parsed.get("C") === "ba", "bóc nháy đơn");
  ok(!parsed.has("D"), "dòng mở đầu bằng # là chú thích, không phải biến");
  ok(parsed.get("E") === "co khoang trang", "trim cả hai vế quanh dấu =");
  ok(!parsed.has(""), "dòng không có khoá thì bỏ, không đẻ ra khoá rỗng");

  // `=` trong CHÍNH giá trị: chuỗi kết nối Postgres đầy rẫy (`?sslmode=require&x=y`). Tách ở dấu
  // `=` ĐẦU TIÊN, đúng như loadEnv — tách ở dấu cuối là cắt nát mọi DATABASE_URL.
  ok(
    parseEnvFile('DATABASE_URL="postgres://u:p@h/db?sslmode=require&channel_binding=require"').get("DATABASE_URL") ===
      "postgres://u:p@h/db?sslmode=require&channel_binding=require",
    "tách ở dấu = ĐẦU TIÊN, giữ nguyên mọi dấu = trong giá trị",
  );
  // Không xử lý ký tự thoát — loadEnv cũng không. Bản đọc "thông minh hơn" ở đây là bản đọc LỆCH.
  ok(parseEnvFile(String.raw`A="x\ny"`).get("A") === String.raw`x\ny`, "KHÔNG giải mã \\n — y hệt loadEnv");
  ok(parseEnvFile("A=1\nA=2").get("A") === "1", "khoá trùng thì lần ĐẦU thắng, đúng luật loadEnv");
}

// ---- Viết ra: đọc lại phải y nguyên -----------------------------------------------------------
{
  ok(formatEnvValue("don-gian") === '"don-gian"', "luôn bao nháy, kể cả giá trị hiền lành");
  // `#` giữa dòng: loadEnv đọc trọn, còn dotenv của Next cắt tại đó. Bao nháy là chỗ hai bên gặp nhau.
  const withHash = 'postgres://u:p#1@h/db';
  ok(parseEnvFile(`K=${formatEnvValue(withHash)}`).get("K") === withHash, "giá trị chứa # vẫn đọc lại trọn vẹn");
  ok(formatEnvValue(`co "nhay kep"`).startsWith("'"), "có nháy kép thì đổi sang bao nháy đơn");
  ok(parseEnvFile(`K=${formatEnvValue(`co "nhay kep"`)}`).get("K") === `co "nhay kep"`, "…và vẫn đọc lại đúng");

  let threw = "";
  try {
    formatEnvValue(`ca "hai" va 'hai'`);
  } catch (err) {
    threw = err instanceof Error ? err.message : "";
  }
  ok(threw.includes("nháy đơn lẫn nháy kép"), "chứa CẢ hai loại nháy thì NÉM, không ghi bừa một chuỗi sai");

  threw = "";
  try {
    formatEnvValue("xuong\ndong");
  } catch (err) {
    threw = err instanceof Error ? err.message : "";
  }
  ok(threw.includes("xuống dòng"), "giá trị có xuống dòng cũng NÉM — một dòng một biến");
}

// ---- Vá: giữ nguyên mọi thứ không liên quan ---------------------------------------------------
{
  const original = ["# chìa của tông môn", "ENCRYPTION_KEY=bi-mat", "", "DATABASE_URL=cu", "OCI_BUCKET=kho", ""].join(
    "\n",
  );
  const res = mergeEnvFile(original, map({ DATABASE_URL: "moi", MONGODB_URI: "mongo-moi" }));

  ok(res.replaced.join() === "DATABASE_URL", "đúng một khoá bị thay");
  ok(res.added.join() === "MONGODB_URI", "khoá chưa có thì được thêm");
  ok(res.text.includes("ENCRYPTION_KEY=bi-mat"), "chìa không liên quan còn NGUYÊN — điều kiện sống còn");
  ok(res.text.includes("# chìa của tông môn"), "chú thích còn nguyên");
  ok(res.text.includes("OCI_BUCKET=kho"), "biến đứng sau khoá bị thay không bị xê dịch");
  const back = parseEnvFile(res.text);
  ok(back.get("DATABASE_URL") === "moi" && back.get("MONGODB_URI") === "mongo-moi", "đọc lại ra đúng giá trị mới");
  ok(back.get("ENCRYPTION_KEY") === "bi-mat" && back.get("OCI_BUCKET") === "kho", "…và những khoá cũ vẫn đúng");

  // THÊM NHIỀU khoá một lượt: bản đầu ghi đè cùng một ô nên chỉ khoá CUỐI sống sót — lỗi tự bắt
  // được lúc soát lại, và nó đứng đây để không tái diễn.
  const many = mergeEnvFile("A=1\n", map({ X: "1", Y: "2", Z: "3" }));
  const manyBack = parseEnvFile(many.text);
  ok(
    many.added.length === 3 && manyBack.get("X") === "1" && manyBack.get("Y") === "2" && manyBack.get("Z") === "3",
    "thêm BA khoá thì cả ba đều có mặt, không phải mỗi khoá cuối",
  );
  ok(manyBack.get("A") === "1", "…và khoá cũ không bị phần thêm nuốt mất");
}

// ---- Vá: không đổi gì thì không đụng tệp ------------------------------------------------------
{
  const original = 'DATABASE_URL="giu-nguyen"\n';
  const res = mergeEnvFile(original, map({ DATABASE_URL: "giu-nguyen" }));
  ok(res.text === original, "giá trị vốn đã đúng thì tệp KHÔNG đổi một byte");
  ok(res.unchanged.join() === "DATABASE_URL" && res.replaced.length === 0, "…và được kể là「không đổi」chứ không phải「đã thay」");
}

// ---- Vá: khoá TRÙNG thì thay MỌI chỗ ----------------------------------------------------------
{
  // loadEnv lấy lần ĐẦU, dotenv của Next lấy lần CUỐI. Vá một chỗ là dựng sẵn cảnh công cụ nối
  // trạm mới còn app nối trạm cũ — đúng loại lỗi im lặng mà tầng gương trạm sinh ra để tránh.
  const res = mergeEnvFile("DATABASE_URL=cu-1\nX=1\nDATABASE_URL=cu-2\n", map({ DATABASE_URL: "moi" }));
  ok(!res.text.includes("cu-1") && !res.text.includes("cu-2"), "CẢ HAI dòng trùng khoá đều được thay");
  ok(res.duplicated.join() === "DATABASE_URL", "…và khoá trùng được BÁO ra để người ta còn dọn");
}

// ---- Vá: xuống dòng theo đúng tệp gốc ---------------------------------------------------------
{
  const crlf = mergeEnvFile("A=1\r\nDATABASE_URL=cu\r\n", map({ DATABASE_URL: "moi", B: "2" }));
  ok(!/[^\r]\n/.test(crlf.text), "tệp CRLF thì mọi dòng — kể cả dòng vá và dòng thêm — vẫn CRLF");
  ok(parseEnvFile(crlf.text).get("B") === "2", "…và dòng thêm vào đọc lại được");

  const lf = mergeEnvFile("A=1\nDATABASE_URL=cu\n", map({ DATABASE_URL: "moi", B: "2" }));
  ok(!lf.text.includes("\r"), "tệp LF thì không tự nhiên mọc ra CR");
  ok(lf.text.endsWith("\n") && !lf.text.endsWith("\n\n"), "…và vẫn kết bằng ĐÚNG một dòng mới");
}

// ---- Vá: tệp rỗng / thiếu dòng kết ------------------------------------------------------------
{
  const empty = mergeEnvFile("", map({ A: "1" }));
  ok(parseEnvFile(empty.text).get("A") === "1", "tệp rỗng vẫn nhận được biến đầu tiên");

  const noEol = mergeEnvFile("A=1", map({ B: "2" }));
  const back = parseEnvFile(noEol.text);
  ok(back.get("A") === "1" && back.get("B") === "2", "tệp thiếu dòng kết: biến cũ không bị dòng thêm dính vào");
  ok(!noEol.text.includes("A=1B="), "…đúng nghĩa là hai dòng rời, không phải một dòng dính");
}

console.log(`\n✔ ${passed} phép kiểm — phép đọc và phép vá tệp .env còn nguyên.`);
