import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const publicDir = path.join(root, "public");

async function generateOgImage() {
  const width = 1200;
  const height = 630;

  // Resize and crop backdrop to 1200x630
  const backdropBuffer = await sharp(path.join(publicDir, "backdrop.png"))
    .resize(width, height, { fit: "cover", position: "center" })
    .toBuffer();

  // Resize seal to 220x220
  const sealBuffer = await sharp(path.join(publicDir, "seal.png"))
    .resize(220, 220, { fit: "contain" })
    .toBuffer();

  // Create an SVG overlay for the text and stylish card
  const svgOverlay = Buffer.from(`
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#0c0a1a" stop-opacity="0.88"/>
          <stop offset="60%" stop-color="#18142e" stop-opacity="0.82"/>
          <stop offset="100%" stop-color="#0c0a1a" stop-opacity="0.92"/>
        </linearGradient>
        <linearGradient id="goldGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#fdf3cd"/>
          <stop offset="50%" stop-color="#e8c25c"/>
          <stop offset="100%" stop-color="#cf9f32"/>
        </linearGradient>
      </defs>

      <!-- Dark card backing behind content -->
      <rect x="60" y="60" width="1080" height="510" rx="24" fill="url(#bgGrad)" stroke="#e8c25c" stroke-width="2" stroke-opacity="0.35"/>

      <!-- Accent badge -->
      <rect x="360" y="115" width="220" height="34" rx="17" fill="#2d224d" stroke="#e8c25c" stroke-width="1.2" stroke-opacity="0.6"/>
      <text x="470" y="138" font-family="system-ui, sans-serif" font-size="14" font-weight="700" fill="#fdf3cd" text-anchor="middle" letter-spacing="1.5">LINH ĐÀI TỰ ĐỘNG</text>

      <!-- Main Title -->
      <text x="360" y="215" font-family="system-ui, sans-serif" font-size="54" font-weight="800" fill="url(#goldGrad)">Auto HH3D</text>

      <!-- Subtitle -->
      <text x="360" y="270" font-family="system-ui, sans-serif" font-size="28" font-weight="600" fill="#e2dcf0">Nhiệm vụ ngày hoathinh3d tự động hoá trên Server</text>

      <!-- Feature Bullet Points -->
      <text x="360" y="340" font-family="system-ui, sans-serif" font-size="20" font-weight="500" fill="#a49eb8">✦ Khôi lỗi chạy 24/7 trên đám mây — Không cần treo máy tính</text>
      <text x="360" y="380" font-family="system-ui, sans-serif" font-size="20" font-weight="500" fill="#a49eb8">✦ Tự động điểm danh, vấn đáp, tế lễ, phúc lợi, hoang vực</text>
      <text x="360" y="420" font-family="system-ui, sans-serif" font-size="20" font-weight="500" fill="#a49eb8">✦ Nhật ký tu luyện minh bạch, bảo mật thông tin an toàn</text>

      <!-- Domain pill -->
      <rect x="360" y="475" width="250" height="42" rx="10" fill="#1f1838" stroke="#e8c25c" stroke-width="1"/>
      <text x="485" y="502" font-family="system-ui, sans-serif" font-size="18" font-weight="700" fill="#fdf3cd" text-anchor="middle">auto-hh3d.online</text>
    </svg>
  `);

  await sharp(backdropBuffer)
    .composite([
      { input: svgOverlay, top: 0, left: 0 },
      { input: sealBuffer, top: 155, left: 100 },
    ])
    .jpeg({ quality: 88, mozjpeg: true })
    .toFile(path.join(publicDir, "og-image.jpg"));

  console.log("Generated: public/og-image.jpg");
}

async function generateIconAndFavicon() {
  const size = 512;

  // Create 512x512 dark themed app icon with the seal centered
  const seal = await sharp(path.join(publicDir, "seal.png"))
    .resize(430, 430, { fit: "contain" })
    .toBuffer();

  const svgBg = Buffer.from(`
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="iconGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#2a1e4a"/>
          <stop offset="100%" stop-color="#0c0a1a"/>
        </radialGradient>
      </defs>
      <rect width="${size}" height="${size}" rx="112" fill="url(#iconGlow)"/>
      <rect x="8" y="8" width="${size - 16}" height="${size - 16}" rx="104" fill="none" stroke="#e8c25c" stroke-width="6" stroke-opacity="0.4"/>
    </svg>
  `);

  const iconBuffer = await sharp(svgBg)
    .composite([{ input: seal, top: 41, left: 41 }])
    .png()
    .toBuffer();

  await fs.writeFile(path.join(publicDir, "icon.png"), iconBuffer);
  console.log("Generated: public/icon.png");

  // Generate 48x48 PNG for favicon.ico
  const favPng = await sharp(iconBuffer)
    .resize(48, 48)
    .png()
    .toBuffer();

  // Construct valid single-image ICO containing PNG data
  const icoHeader = Buffer.alloc(6);
  icoHeader.writeUInt16LE(0, 0); // reserved
  icoHeader.writeUInt16LE(1, 2); // type: 1 = ICO
  icoHeader.writeUInt16LE(1, 4); // 1 image

  const icoEntry = Buffer.alloc(16);
  icoEntry.writeUInt8(48, 0); // width
  icoEntry.writeUInt8(48, 1); // height
  icoEntry.writeUInt8(0, 2);  // color palette (0 = >=8bpp)
  icoEntry.writeUInt8(0, 3);  // reserved
  icoEntry.writeUInt16LE(1, 4); // color planes
  icoEntry.writeUInt16LE(32, 6); // bits per pixel
  icoEntry.writeUInt32LE(favPng.length, 8); // image size
  icoEntry.writeUInt32LE(6 + 16, 12); // offset

  const icoBuffer = Buffer.concat([icoHeader, icoEntry, favPng]);
  await fs.writeFile(path.join(publicDir, "favicon.ico"), icoBuffer);
  console.log("Generated: public/favicon.ico");
}

await generateOgImage();
await generateIconAndFavicon();
