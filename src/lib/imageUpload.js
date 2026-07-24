/**
 * Turn a File the owner picks from their device/gallery into a small, inline
 * data-URI we can store straight on the product (the site has no blob store).
 * The image is downscaled and re-encoded so a phone photo doesn't bloat the DB.
 */
export function fileToDataUrl(file, { max = 600, maxBytes = 700_000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('No file selected.'));
    if (!/^image\//.test(file.type)) return reject(new Error('Please choose an image file.'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Could not process that image.'));
      ctx.drawImage(img, 0, 0, w, h);

      // Keep PNG only if the image really uses transparency (logos); otherwise
      // JPEG — far smaller for photos, so the upload stays under the API limit.
      let hasAlpha = false;
      try {
        const px = ctx.getImageData(0, 0, w, h).data;
        for (let i = 3; i < px.length; i += 4) { if (px[i] < 250) { hasAlpha = true; break; } }
      } catch { hasAlpha = false; }

      try {
        let out;
        if (hasAlpha) {
          out = canvas.toDataURL('image/png');
        } else {
          let q = 0.85;
          out = canvas.toDataURL('image/jpeg', q);
          while (out.length > maxBytes && q > 0.4) { q -= 0.12; out = canvas.toDataURL('image/jpeg', q); }
        }
        if (out.length > 2_400_000) return reject(new Error('That image is too large — please try a smaller one.'));
        resolve(out);
      } catch (err) { reject(new Error('Could not process that image.')); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
    img.src = url;
  });
}

/**
 * Make a near-uniform background (e.g. the white behind a logo/product render)
 * transparent, so the artwork blends onto the card instead of sitting in a
 * white box. Flood-fills from the edges only, so it never punches holes in the
 * subject. Returns a transparent PNG data URI, or null when the background is
 * not uniform enough to remove safely (a real photo/banner is left untouched).
 * Only works on same-origin sources (data URIs / our own assets).
 */
export function removeSolidBackground(src, { tolerance = 34 } = {}) {
  return new Promise((resolve, reject) => {
    if (!src) return reject(new Error('No image.'));
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const w = img.naturalWidth, h = img.naturalHeight;
      if (!w || !h) return reject(new Error('Could not read that image.'));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return reject(new Error('Could not process that image.'));
      ctx.drawImage(img, 0, 0);
      let image;
      try { image = ctx.getImageData(0, 0, w, h); }
      catch { return reject(new Error('This image is from another site — upload it instead so I can edit it.')); }
      const px = image.data;

      // Reference background = average of the four corners; bail if the corners
      // disagree (that means there's no uniform background to strip).
      const at = (x, y) => { const i = (y * w + x) * 4; return [px[i], px[i + 1], px[i + 2]]; };
      const corners = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)];
      const bg = [0, 1, 2].map((k) => Math.round(corners.reduce((s, c) => s + c[k], 0) / 4));
      const dist = (c) => Math.abs(c[0] - bg[0]) + Math.abs(c[1] - bg[1]) + Math.abs(c[2] - bg[2]);
      if (Math.max(...corners.map(dist)) > 70) return resolve(null); // not a flat background

      const thr = tolerance * 3;
      const idxClose = (i) => (Math.abs(px[i] - bg[0]) + Math.abs(px[i + 1] - bg[1]) + Math.abs(px[i + 2] - bg[2])) <= thr;
      const visited = new Uint8Array(w * h);
      const stack = [];
      const push = (x, y) => { if (x >= 0 && x < w && y >= 0 && y < h) { const p = y * w + x; if (!visited[p]) { visited[p] = 1; stack.push(p); } } };
      for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
      for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
      let cleared = 0;
      while (stack.length) {
        const p = stack.pop(); const i = p * 4;
        if (!idxClose(i)) continue;
        px[i + 3] = 0; cleared++;
        const x = p % w, y = (p / w) | 0;
        push(x - 1, y); push(x + 1, y); push(x, y - 1); push(x, y + 1);
      }
      if (cleared < w * h * 0.02) return resolve(null); // barely removed anything → leave as-is

      // Soften the fringe: pixels that survived but are still close to the old
      // background get partial transparency, killing the white halo.
      for (let p = 0; p < w * h; p++) {
        const i = p * 4;
        if (px[i + 3] === 0) continue;
        const d = Math.abs(px[i] - bg[0]) + Math.abs(px[i + 1] - bg[1]) + Math.abs(px[i + 2] - bg[2]);
        if (d < thr * 1.6) px[i + 3] = Math.round(255 * (d / (thr * 1.6)));
      }
      ctx.putImageData(image, 0, 0);
      try { resolve(canvas.toDataURL('image/png')); }
      catch { reject(new Error('Could not process that image.')); }
    };
    img.onerror = () => reject(new Error('Could not read that image.'));
    img.src = src;
  });
}

/** Short human label for an image value (hides the huge data-URI string). */
export function imageLabel(value) {
  const v = String(value || '');
  if (!v) return '';
  if (v.startsWith('data:')) return 'Uploaded image';
  return v;
}
