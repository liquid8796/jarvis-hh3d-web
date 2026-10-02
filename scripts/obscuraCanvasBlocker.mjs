/**
 * CanvasBlocker cho Obscura — nạp qua CDP Init Script (page.addInitScript).
 *
 * Obscura là trình duyệt không đầu viết bằng Rust, không hỗ trợ tiện ích Chrome
 * dạng extension directory (--load-extension). Module này trích xuất toàn bộ cơ chế
 * can thiệp và gieo nhiễu (noise injection) của CanvasBlocker sang JavaScript thuần,
 * nạp thẳng vào execution context trước khi bất kỳ script của trang nào được thực thi.
 *
 * Chức năng:
 *   - Can thiệp CanvasRenderingContext2D.prototype.getImageData
 *   - Can thiệp HTMLCanvasElement.prototype.toDataURL và toBlob
 *   - Can thiệp WebGLRenderingContext / WebGL2RenderingContext prototype.readPixels
 *   - Gieo nhiễu giả ngẫu nhiên có tính xác định theo seed mỗi chu kỳ
 *   - Ngụy trang hàm Function.prototype.toString trả về "[native code]"
 */

export function getCanvasBlockerInitScript(seed = Math.floor(Math.random() * 1_000_000_000)) {
  const seedNum = Number(seed) || 123456789;
  return `(function() {
  if (window.__obscura_canvas_blocker__) return;
  window.__obscura_canvas_blocker__ = true;

  let s = ${seedNum};
  function random() {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }

  function maskFunction(fn, originalName) {
    try {
      Object.defineProperty(fn, "name", { value: originalName, configurable: true });
      const origToString = Function.prototype.toString;
      fn.toString = function() {
        return "function " + originalName + "() { [native code] }";
      };
      fn.toString.toString = function() {
        return "function toString() { [native code] }";
      };
    } catch {}
  }

  // 1. Can thiệp Canvas 2D getImageData
  if (typeof CanvasRenderingContext2D !== "undefined" && CanvasRenderingContext2D.prototype.getImageData) {
    const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = function(...args) {
      const imageData = origGetImageData.apply(this, args);
      if (imageData && imageData.data && imageData.data.length >= 4) {
        const d = imageData.data;
        const step = Math.max(4, Math.floor(d.length / 50));
        for (let i = 0; i < d.length; i += step) {
          const delta = random() > 0.5 ? 1 : -1;
          d[i] = Math.max(0, Math.min(255, d[i] + delta));
        }
      }
      return imageData;
    };
    maskFunction(CanvasRenderingContext2D.prototype.getImageData, "getImageData");
  }

  // 2. Can thiệp toDataURL và toBlob
  if (typeof HTMLCanvasElement !== "undefined") {
    if (HTMLCanvasElement.prototype.toDataURL) {
      const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function(...args) {
        try {
          const ctx = this.getContext("2d");
          if (ctx && this.width > 0 && this.height > 0) {
            const w = Math.min(4, this.width);
            const h = Math.min(4, this.height);
            const img = ctx.getImageData(0, 0, w, h);
            img.data[0] = Math.max(0, Math.min(255, img.data[0] + (random() > 0.5 ? 1 : -1)));
            ctx.putImageData(img, 0, 0);
          }
        } catch {}
        return origToDataURL.apply(this, args);
      };
      maskFunction(HTMLCanvasElement.prototype.toDataURL, "toDataURL");
    }

    if (HTMLCanvasElement.prototype.toBlob) {
      const origToBlob = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function(callback, ...args) {
        try {
          const ctx = this.getContext("2d");
          if (ctx && this.width > 0 && this.height > 0) {
            const w = Math.min(4, this.width);
            const h = Math.min(4, this.height);
            const img = ctx.getImageData(0, 0, w, h);
            img.data[0] = Math.max(0, Math.min(255, img.data[0] + (random() > 0.5 ? 1 : -1)));
            ctx.putImageData(img, 0, 0);
          }
        } catch {}
        return origToBlob.call(this, callback, ...args);
      };
      maskFunction(HTMLCanvasElement.prototype.toBlob, "toBlob");
    }
  }

  // 3. Can thiệp WebGL readPixels
  function patchWebGL(proto) {
    if (!proto || !proto.readPixels) return;
    const origReadPixels = proto.readPixels;
    proto.readPixels = function(x, y, width, height, format, type, pixels) {
      origReadPixels.call(this, x, y, width, height, format, type, pixels);
      if (pixels && pixels.length > 0) {
        pixels[0] = Math.max(0, Math.min(255, pixels[0] + (random() > 0.5 ? 1 : -1)));
      }
    };
    maskFunction(proto.readPixels, "readPixels");
  }

  if (typeof WebGLRenderingContext !== "undefined") patchWebGL(WebGLRenderingContext.prototype);
  if (typeof WebGL2RenderingContext !== "undefined") patchWebGL(WebGL2RenderingContext.prototype);
})();`;
}
