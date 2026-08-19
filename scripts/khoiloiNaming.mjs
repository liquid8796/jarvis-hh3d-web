/**
 * LUẬT ĐẶT TÊN cho những cái tên mà lượt dựng khôi lỗi GitHub TỰ SINH RA — thuần, không mạng,
 * không database, không đọc `.env`.
 *
 * `.mjs` chứ không `.ts` là BẮT BUỘC chứ không phải tuỳ thích: hai script phải cùng nghe MỘT luật,
 * mà `newGithubKhoiloi.mjs` chạy bằng `node` trần — xem `spawnSync(process.execPath, …)` bên
 * `newGithubStation.mts` — nên nó không nhập nổi một tệp TypeScript. Chiều ngược lại thì thông:
 * `.mts` nhập `.mjs` được. Cùng lối `loadEnv.mjs` đang đi.
 *
 * VÌ SAO TÁCH RA: trước tệp này, tiền tố tên kho nằm ở HAI bản chép tay (`REPO_PREFIX` bên
 * `newGithubStation.mts` và giá trị mặc định của `--repo` bên `newGithubKhoiloi.mjs`) — hai chuỗi
 * bằng nhau vì may, không vì có gì buộc chúng bằng nhau. Đổi một bên là đẻ ra hai họ tên kho sống
 * song song, mà tên kho lại là thứ lượt XOÁ dùng để khoanh vùng ứng viên.
 */

/**
 * NHỮNG TỪ KHÔNG ĐƯỢC PHÉP CÓ TRONG MỘT CÁI TÊN TA TỰ ĐẶT.
 *
 * Hai nhóm, hai lý do khác hẳn nhau — trộn chúng vào một danh sách là để tiện kiểm, không phải vì
 * chúng cùng loại:
 *
 *   • `auto`, `hh3d`, `hoathinh3d` — buộc kho vào đúng cái trò nó đang cày. Kho là CÔNG KHAI và
 *     GitHub có ô tìm kiếm: một lượt gõ「hh3d」là ra sạch cả đàn, kèm nhật ký Actions của từng cái.
 *   • `worker`, `action`, `workflow`, `github` — không buộc vào trò nào, nhưng chúng dựng đúng
 *     chân dung「kho sinh ra để xài quỹ phút Actions」. GitHub đã gỡ `gautamkrishnar/keepalive-workflow`
 *     vì hành vi chứ không vì cái tên, nhưng cái tên là thứ đưa người ta tới chỗ nhìn hành vi.
 *
 * SO KHỚP THEO CHUỖI CON, KHÔNG THEO TỪ, và cố ý: `actions` chứa `action`, `Auto` chứa `auto`,
 * `my-github-bot` chứa `github`. Ranh giới từ ở đây chỉ tổ để lọt.
 *
 * `hh3d` KHÔNG nằm trong `hoathinh3d` (hoat-hin-h3d → có `nh3d`, không có `hh3d`), nên cả hai
 * đều phải có mặt. Đừng rút gọn danh sách.
 */
export const FORBIDDEN_NAME_WORDS = Object.freeze([
  "auto",
  "hh3d",
  "hoathinh3d",
  "worker",
  "action",
  "workflow",
  "github",
  // Nhóm thứ BA, thêm 17/08/2026 theo yêu cầu của tông chủ: những chữ của CHÍNH TA. `linh-su` và
  // `khoiloi` không nói gì với người lạ về trò chơi, nhưng chúng nối các kho lại với nhau — thấy
  // một cái là dò ra cả đàn, và nối luôn kho GitHub với id trên dashboard. Viết cả hai lối gạch
  // nối lẫn liền vì tên kho dùng gạch nối còn WORKER_ID thì không nhất thiết.
  "khoiloi",
  "khoi-loi",
  "linhsu",
  "linh-su",
]);

/**
 * HAI RỔ TỪ ghép thành một cái tên nghe như một thư viện mã nguồn mở bất kỳ.
 *
 * Vì sao đổi hẳn sang tên ngẫu nhiên (17/08/2026): một tiền tố cố định là một cái móc. Dù
 * `linh-su` không nói gì về trò chơi, nó vẫn khiến TÁM kho trên tám tài khoản khác nhau nhận ra
 * nhau bằng mắt thường — mà cái đàn ấy mới là thứ đáng giấu, không phải từng cái một. Tên ngẫu
 * nhiên thì mỗi kho đứng một mình.
 *
 * Không có mốc thời gian trong tên, và đó cũng là chủ ý: `…-20260813-233056-6143` là chữ ký của
 * một cỗ máy sinh tên. Một kho tên `cobalt-relay-4f2a` thì không.
 *
 * Chọn từ TRUNG TÍNH: vật liệu, màu, địa hình ghép với danh từ hạ tầng. Tránh mọi thứ nghe như
 * bot/farm/mining, và tất nhiên tránh danh sách cấm ở trên — `verify:khoiloi-naming` soi từng từ
 * một trong hai rổ, nên thêm một từ hớ vào đây là lưới đỏ ngay dưới máy.
 *
 * ── VÌ SAO RỔ PHẢI TO (19/08/2026, tông chủ yêu cầu) ─────────────────────────────────────────
 *
 * Bản đầu có 20 × 18 = 360 cặp, và cái hỏng KHÔNG phải là trùng tên: đuôi hex đã lo việc ấy (360
 * × 65536 ≈ 23,6 triệu). Cái hỏng là **giống mặt nhau**. Với 20 từ đầu, chín kho gần như chắc
 * chắn có vài cái chung một từ — sổ ngày 19/08 đo được đúng thế: `vellum-loom-ee60` và
 * `vellum-loom-bd35` trùng CẢ CẶP, còn `amber-bridge` / `amber-render` và `jade-pier` /
 * `garnet-pier` thì chung một nửa. Ba cái tên như vậy nằm trên ba tài khoản khác nhau vẫn nhận ra
 * nhau bằng mắt thường — tức đúng thứ mà cú đổi sang tên ngẫu nhiên (17/08) sinh ra để phá.
 *
 * Nay 221 × 244 = 53.924 cặp. Chín kho thì xác suất chạm một cặp trùng rơi từ ~10% xuống ~0,07%;
 * chung một từ đầu rơi từ gần như chắc chắn xuống ~2%. Trần thật của cả cái tên là 53.924 × 65536
 * ≈ 3,5 tỉ.
 *
 * Thêm từ thì cứ thêm, nhưng giữ ba luật mà lưới đang canh: chỉ `a-z`, dài 3–10 ký tự, và HAI RỔ
 * KHÔNG ĐƯỢC GIAO NHAU.
 */
export const NAME_HEADS = Object.freeze([
  "alabaster", "almond", "alpine", "amber", "amethyst", "anise", "arbor", "ash",
  "aspen", "aster", "aurora", "azure", "bamboo", "banyan", "barley", "basalt",
  "bayberry", "beryl", "birch", "bismuth", "bloom", "boulder", "bramble", "brass",
  "briar", "bronze", "burl", "cactus", "calico", "canyon", "cedar", "chalk",
  "cherry", "chestnut", "cider", "cinder", "citrine", "clay", "clover", "cobalt",
  "cobble", "comet", "copper", "coral", "cotton", "crag", "cream", "crimson",
  "crocus", "crystal", "cypress", "dahlia", "delta", "dogwood", "driftwood", "dune",
  "dusk", "ebony", "elder", "elm", "emerald", "fallow", "feather", "fennel",
  "fern", "fjord", "flax", "fleece", "flint", "flora", "forest", "fossil",
  "frost", "gale", "garland", "garnet", "geode", "ginger", "glacier", "glade",
  "gneiss", "granite", "graphite", "grove", "gypsum", "harvest", "hazel", "heather",
  "hemlock", "hickory", "hollow", "holly", "honey", "indigo", "iris", "ironwood",
  "ivory", "ivy", "jade", "jasper", "juniper", "kelp", "lagoon", "lapis",
  "larch", "laurel", "lava", "lichen", "lilac", "lime", "linen", "loam",
  "lotus", "lunar", "magma", "magnolia", "malachite", "mango", "maple", "marble",
  "marigold", "meadow", "mesa", "mica", "midnight", "mint", "mist", "moss",
  "mulberry", "myrtle", "nebula", "nickel", "nimbus", "oak", "oasis", "obsidian",
  "ochre", "olive", "onyx", "opal", "orchid", "palm", "pampas", "papyrus",
  "pearl", "pebble", "pepper", "peridot", "pewter", "pine", "plum", "poplar",
  "prairie", "pumice", "quarry", "quartz", "rain", "redwood", "reef", "resin",
  "rhubarb", "ridge", "rill", "ripple", "river", "rose", "rowan", "ruby",
  "rust", "saffron", "sage", "sand", "sandstone", "sapphire", "savanna", "scarlet",
  "sequoia", "shale", "shore", "sienna", "silica", "silver", "sky", "slate",
  "sorrel", "spruce", "steel", "stone", "storm", "stream", "sumac", "summit",
  "sycamore", "taiga", "tallow", "tamarind", "teak", "thicket", "thistle", "tide",
  "timber", "topaz", "tulip", "tundra", "turquoise", "umber", "valley", "vellum",
  "velvet", "verdant", "vine", "violet", "walnut", "wheat", "willow", "winter",
  "wisteria", "yarrow", "yew", "zinc", "zircon",
]);

/**
 * Nửa sau: danh từ hạ tầng, thứ hay thấy trong tên thư viện thật. Hai rổ KHÔNG giao nhau — một
 * cái tên「prism-prism-4f2a」đọc lên là biết ngay có máy sinh ra nó.
 */
export const NAME_TAILS = Object.freeze([
  "anchor", "anvil", "arcade", "archive", "array", "atlas", "atrium", "axle",
  "bastion", "beacon", "beam", "bearing", "bellows", "bench", "binder", "blueprint",
  "boiler", "bolt", "brace", "bracket", "bridge", "buffer", "bunker", "buoy",
  "cabinet", "cable", "cairn", "caliper", "canal", "canvas", "capsule", "caravan",
  "carriage", "cartridge", "cask", "causeway", "cell", "chamber", "channel", "chart",
  "chassis", "chisel", "circuit", "cistern", "citadel", "clamp", "cluster", "cog",
  "coil", "column", "compass", "conduit", "console", "corral", "cradle", "crane",
  "crate", "crest", "crossing", "crucible", "cursor", "dam", "depot", "derrick",
  "dial", "diode", "dock", "dome", "drum", "dynamo", "echo", "engine",
  "envelope", "fabric", "ferry", "filament", "fixture", "flange", "flask", "fleet",
  "forge", "foundry", "frame", "gantry", "gate", "gauge", "gear", "girder",
  "glyph", "granary", "grid", "groove", "gyro", "hangar", "harness", "hatch",
  "haven", "hearth", "helm", "hinge", "hoist", "hub", "index", "ingot",
  "inlet", "junction", "keel", "kernel", "keystone", "kiln", "lattice", "ledger",
  "lens", "lever", "lighthouse", "lock", "lodge", "loft", "loom", "mandrel",
  "manifold", "mantle", "marker", "mast", "matrix", "meridian", "mesh", "mill",
  "module", "mold", "monolith", "mooring", "mortar", "nexus", "node", "nozzle",
  "obelisk", "orbit", "outpost", "palisade", "panel", "parapet", "pavilion", "pendulum",
  "pier", "pillar", "pinion", "pipeline", "piston", "pivot", "platform", "plinth",
  "plotter", "pontoon", "portal", "press", "prism", "pulley", "pump", "quay",
  "rack", "rafter", "rail", "rampart", "ratchet", "reactor", "reel", "refinery",
  "register", "relay", "render", "reservoir", "rig", "ring", "rivet", "rotor",
  "rudder", "rung", "runway", "sail", "scaffold", "schema", "scope", "sector",
  "sentinel", "servo", "shaft", "shelf", "shipyard", "shuttle", "sieve", "signal",
  "silo", "sluice", "socket", "spar", "spindle", "spire", "spool", "spring",
  "sprocket", "stack", "stage", "stanchion", "station", "stencil", "strand", "stratum",
  "sump", "switch", "tablet", "tackle", "tank", "tender", "terminal", "terrace",
  "tether", "thread", "throttle", "tiller", "tower", "transit", "treadle", "trellis",
  "trestle", "trolley", "trough", "truss", "tunnel", "turbine", "turret", "valve",
  "vane", "vault", "vector", "vessel", "viaduct", "vise", "wharf", "winch",
  "windlass", "wire", "yard", "yoke",
]);

/**
 * Một cái tên mới: `<đầu>-<đuôi>-<4 hex>`.
 *
 * Đuôi hex KHÔNG phải để trang trí — nó là thứ giữ cho hai lượt dựng cùng rơi vào một cặp từ vẫn
 * ra hai cái tên khác nhau. Từ 19/08/2026 rổ rộng hơn 150 lần (53.924 cặp) nên cặp trùng đã thành
 * chuyện hiếm, nhưng hex vẫn phải ở lại: người gọi vẫn soát trùng với sổ, và hex là thứ biến
 *「hiếm」thành「gần như không bao giờ」.
 *
 * `pick` tiêm vào được để lưới kiểm chứng chạy tất định; mặc định là ngẫu nhiên thật.
 *
 * @param {(n: number) => number} [pick] trả về một số nguyên trong [0, n)
 */
export function randomSoftwareName(pick = (n) => Math.floor(Math.random() * n)) {
  const head = NAME_HEADS[pick(NAME_HEADS.length)];
  const tail = NAME_TAILS[pick(NAME_TAILS.length)];
  const hex = Array.from({ length: 4 }, () => "0123456789abcdef"[pick(16)]).join("");
  return `${head}-${tail}-${hex}`;
}

/**
 * HÌNH DẠNG của một cái tên do ta sinh ra — thứ thay chỗ cho「bắt đầu bằng tiền tố」sau lượt đổi
 * sang tên ngẫu nhiên.
 *
 * Lượt XOÁ cần một bộ lọc rẻ để khoanh vùng ứng viên trên một tài khoản, và trước đây nó lọc bằng
 * tiền tố. Tên ngẫu nhiên không còn tiền tố nào, nên nếu bỏ trắng chỗ này thì **kho dựng dở** —
 * cảnh cần dọn nhất, và cũng là cảnh KHÔNG có dòng nào trong sổ để bắt bằng đường khác — sẽ tàng
 * hình trước chính công cụ dọn của mình.
 *
 * Nên bộ lọc chuyển từ TỪ sang HÌNH: hai từ thường và bốn ký tự hex. Nó đủ hẹp để chỉ còn vài ứng
 * viên trên một tài khoản, và đủ tầm thường để không nói gì với người lạ. Vẫn KHÔNG phải giấy
 * phép xoá — `Evidence` mới là, y như trước.
 */
/**
 * `name` trong `package.json` của kho khôi lỗi — MỘT chuỗi dùng chung cho mọi kho, và đó là ràng
 * buộc kỹ thuật chứ không phải lười.
 *
 * Lockfile được dựng ĐÚNG MỘT LẦN rồi đẩy cho mọi kho (`generateLockfile(renderPackageJsonFor(…))`
 * bên `deployGithubKhoiloi.mts`), mà lockfile thì mang tên gói bên trong — nên `name` đổi theo
 * từng kho là phải chạy `npm install` một lần cho mỗi kho.
 *
 * Nói thẳng cái giá: đây là một sợi dây MỀM nối các kho lại với nhau — mở `package.json` ra là
 * thấy chúng cùng một chữ. Nó yếu hơn hẳn một tiền tố trong TÊN KHO (thứ nhìn thấy từ ô tìm kiếm,
 * không phải mở tệp mới thấy), nên lượt 17/08/2026 chấp nhận giữ nó và đổi chữ sang một cái tên
 * không nói gì: bản trước dùng chính tiền tố tên kho.
 */
export const PACKAGE_NAME = "scheduled-tasks";

export const GENERATED_NAME_SHAPE = /^[a-z]+-[a-z]+-[0-9a-f]{4}$/;

/**
 * Những tiền tố tên kho mà các bản TRƯỚC từng đặt — **không còn tiền tố nào đang hành nghề**.
 *
 * Từ 17/08/2026 tên kho do `randomSoftwareName()` sinh ra, không mang tiền tố nào cả, nên danh
 * sách này thuần tuý là SỬ LIỆU: lượt XOÁ dùng nó (cùng với `GENERATED_NAME_SHAPE`) làm bộ lọc rẻ
 * để khoanh vùng ứng viên trên một tài khoản. Bỏ một tiền tố cũ đi là làm những kho dựng trước đó
 * tàng hình trước chính công cụ dọn của mình — mà đúng cảnh cần dọn nhất, kho rỗng dựng dở
 * (`gh repo create --push` chết giữa chừng), lại là cảnh KHÔNG có dòng nào trong sổ để bắt bằng
 * đường khác.
 *
 * Nới bộ lọc thì an toàn theo đúng thiết kế: tiền tố chưa bao giờ là giấy phép xoá, `Evidence` mới
 * là — xem `reviewRemoval` bên `githubKhoiloi.mts`.
 *
 * `linh-su` vào danh sách này ngày 17/08/2026, cùng lượt nó bị đưa vào `FORBIDDEN_NAME_WORDS`:
 * một cái tên vừa bị cấm sinh ra thì vẫn phải bị nhìn thấy lúc dọn.
 */
export const LEGACY_REPO_NAME_PREFIXES = Object.freeze(["auto-hh3d-linh-su", "linh-su"]);

/** Mọi tiền tố tên kho từng dùng. Dùng cho bộ lọc của lượt xoá, cùng `GENERATED_NAME_SHAPE`. */
export const ALL_REPO_NAME_PREFIXES = LEGACY_REPO_NAME_PREFIXES;

/** Những từ cấm có mặt trong `value` — mảng rỗng nghĩa là sạch. */
export function forbiddenWordsIn(value) {
  const lower = String(value).toLowerCase();
  return FORBIDDEN_NAME_WORDS.filter((word) => lower.includes(word));
}

/**
 * Trả về lời từ chối, hoặc `null` nếu tên dùng được — cùng hình dạng với `reviewStationIdentity`
 * bên `src/lib/validation/githubStations.ts`, và cố ý trả CHUỖI thay vì ném: hai script gọi nó có
 * hai lối từ chối khác nhau (`die()` ném `Stop`, còn bên kia in rồi `process.exit`), nên chỗ này
 * chỉ nói cái sai, không giành quyền quyết định chết thế nào.
 *
 * KIỂM CẢ TÊN NGƯỜI VẬN HÀNH GÕ TAY qua `--repo` / `--worker-id`, không chỉ tên tự sinh. Đó là
 * toàn bộ khác biệt giữa「một luật」và「một hằng số vừa được sửa」: hằng số thì lượt sau ai gõ tay
 * một cái tên là lọt, còn luật thì không.
 *
 * KHÔNG áp cho `owner`. Tên tài khoản GitHub nằm sẵn trong đường dẫn kho — `github.com/<owner>/…`
 * — nên không cái tên nào ta đặt giấu được nó, và từ chối vì nó là bắt người ta đổi tài khoản để
 * chạy một script. Khi `owner` lọt vào một cái tên tự sinh (mặc định `--worker-id` bên
 * `newGithubKhoiloi.mjs`) thì lời từ chối ở dưới đã chỉ đúng lối thoát: truyền tay một id khác.
 */
export function reviewGeneratedName(what, value) {
  const hits = forbiddenWordsIn(value);
  if (hits.length === 0) return null;
  return (
    `${what}「${value}」mang từ cấm: ${hits.join(", ")}.\n` +
    `  Kho khôi lỗi là kho CÔNG KHAI, nên cái tên là thứ duy nhất người lạ thấy trước khi mở nhật\n` +
    `  ký Actions ra đọc. Danh sách đầy đủ: ${FORBIDDEN_NAME_WORDS.join(", ")}.\n` +
    `  Bỏ cờ --repo/--worker-id để script tự đặt tên hợp luật, hoặc gõ một cái tên không chứa\n` +
    `  những từ ấy.`
  );
}
