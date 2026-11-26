/** Shrinks a chosen picture to a logo (max 360 px on the long side) and returns a PNG data URI (JPEG if PNG would be too big). */
export function logoToDataUri(file) {
  return new Promise((resolve, reject) => {
    const img = new Image(); const r = new FileReader();
    r.onerror = () => reject(new Error('Could not read the file'));
    r.onload = () => {
      img.onerror = () => reject(new Error('That file is not a picture'));
      img.onload = () => {
        const k = Math.min(1, 360 / Math.max(img.width, img.height)); const w = Math.max(1, Math.round(img.width * k)); const h = Math.max(1, Math.round(img.height * k));
        const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.drawImage(img, 0, 0, w, h);
        let out = c.toDataURL('image/png'); if (out.length > 400000) { g.globalCompositeOperation = 'destination-over'; g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); out = c.toDataURL('image/jpeg', 0.85); }
        resolve(out);
      };
      img.src = r.result;
    };
    r.readAsDataURL(file);
  });
}
