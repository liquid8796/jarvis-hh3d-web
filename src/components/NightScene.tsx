/**
 * Chân trời của bối cảnh đêm trăng: dãy núi xa, thuỷ đình bên trái, chùa nhỏ bên phải,
 * và dải mặt nước hắt sáng dưới cùng — phỏng theo tấm cảnh "Phàm Nhân Tu Tiên" làm chuẩn.
 *
 * Một SVG tĩnh, cố định đáy màn hình, sau nội dung. Thuần bóng (silhouette) có chủ ý:
 * đây là phông nền cho chữ đọc bên trên, không phải tranh để ngắm — mọi chi tiết đều tối
 * và trầm, chỉ cửa sổ đền chùa được thắp vài đốm vàng ấm cho cảnh có hồn. Không animation:
 * lớp chuyển động đã có mây, sao và lá; chân trời mà cũng trôi thì cả trang bồng bềnh.
 */
export function NightScene() {
  return (
    <svg
      className="scene"
      viewBox="0 0 1440 260"
      preserveAspectRatio="xMidYMax slice"
      aria-hidden
    >
      <defs>
        {/* Nước loang ánh trăng: sáng mờ ở giữa, chìm dần về hai mép. */}
        <linearGradient id="water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#16223f" stopOpacity="0.9" />
          <stop offset="0.35" stopColor="#0d1730" stopOpacity="0.96" />
          <stop offset="1" stopColor="#070c1c" />
        </linearGradient>
        <linearGradient id="ridgeFar" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1a2647" />
          <stop offset="1" stopColor="#101a36" />
        </linearGradient>
        <linearGradient id="ridgeNear" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0e1832" />
          <stop offset="1" stopColor="#081026" />
        </linearGradient>
      </defs>

      {/* Dãy núi xa — nét răng cưa mềm, mờ dần vào sương. */}
      <path
        fill="url(#ridgeFar)"
        opacity="0.85"
        d="M0 190 L70 160 L140 185 L230 140 L310 178 L400 130 L470 168 L560 150 L640 180
           L740 145 L830 175 L920 135 L1010 172 L1100 150 L1190 178 L1280 142 L1360 170
           L1440 155 L1440 260 L0 260 Z"
      />

      {/* Dãy núi gần, tối hơn. */}
      <path
        fill="url(#ridgeNear)"
        d="M0 215 L90 190 L180 210 L290 175 L380 205 L500 185 L610 208 L730 180 L850 205
           L960 185 L1080 210 L1200 188 L1320 208 L1440 190 L1440 260 L0 260 Z"
      />

      {/* Thuỷ đình trên đảo nhỏ bên trái — như trong tranh, đứng một mình giữa nước. */}
      <g transform="translate(150 176)">
        {/* đảo */}
        <path d="M-46 34 Q0 20 46 34 L40 44 L-40 44 Z" fill="#0a132b" />
        {/* thân đình */}
        <rect x="-15" y="6" width="30" height="26" fill="#0a132b" />
        {/* hai tầng mái cong */}
        <path d="M-30 8 Q0 -8 30 8 Q18 2 0 2 Q-18 2 -30 8 Z" fill="#0c1630" />
        <path d="M-22 -4 Q0 -18 22 -4 Q12 -9 0 -9 Q-12 -9 -22 -4 Z" fill="#0c1630" />
        <path d="M0 -22 L0 -9" stroke="#0c1630" strokeWidth="2" />
        {/* đèn trong đình — hai đốm ấm, lý do duy nhất cảnh này không chết lặng */}
        <rect x="-9" y="14" width="5" height="7" fill="#e8b45c" opacity="0.85" />
        <rect x="4" y="14" width="5" height="7" fill="#e8b45c" opacity="0.6" />
      </g>

      {/* Cầu gỗ thấp nối vào đảo. */}
      <path
        d="M196 214 L340 224 M210 214 L210 222 M240 216 L240 224 M270 217 L270 225 M300 219 L300 226"
        stroke="#0a132b"
        strokeWidth="3"
        fill="none"
      />

      {/* Quần thể chùa bên phải, cao dần theo sườn núi. */}
      <g transform="translate(1220 148)" fill="#0a132b">
        <rect x="-14" y="18" width="28" height="22" />
        <path d="M-26 20 Q0 6 26 20 Q14 14 0 14 Q-14 14 -26 20 Z" fill="#0c1630" />
        <path d="M-19 6 Q0 -6 19 6 Q10 1 0 1 Q-10 1 -19 6 Z" fill="#0c1630" />
        <rect x="-5" y="26" width="4" height="6" fill="#e8b45c" opacity="0.75" />
        <rect x="34" y="30" width="22" height="16" />
        <path d="M24 32 Q45 20 66 32 Q56 26 45 26 Q34 26 24 32 Z" fill="#0c1630" />
        <rect x="42" y="36" width="4" height="5" fill="#e8b45c" opacity="0.55" />
        <rect x="-52" y="34" width="20" height="12" />
        <path d="M-60 36 Q-42 26 -24 36 Q-33 31 -42 31 Q-51 31 -60 36 Z" fill="#0c1630" />
      </g>

      {/* Mặt nước + vệt trăng loang: vài nét ngang mảnh, đậm nhạt xen kẽ. */}
      <rect x="0" y="226" width="1440" height="34" fill="url(#water)" />
      <g stroke="#c9d8f2" strokeWidth="1" opacity="0.18">
        <path d="M520 234 h180 M560 240 h120 M540 247 h150 M580 253 h90" />
      </g>
      <g stroke="#e8c25c" strokeWidth="1" opacity="0.22">
        <path d="M120 236 h60 M140 243 h36 M1180 238 h70 M1205 246 h40" />
      </g>
    </svg>
  );
}
