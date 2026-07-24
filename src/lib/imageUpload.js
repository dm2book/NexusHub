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

/** Short human label for an image value (hides the huge data-URI string). */
export function imageLabel(value) {
  const v = String(value || '');
  if (!v) return '';
  if (v.startsWith('data:')) return 'Uploaded image';
  return v;
}
