// Minimal dependency-free PDF writer (one page, Helvetica text, rectangles, JPEG images).
const SUB = { "–": "-", "—": "-", "−": "-", "σ": "sigma", "≈": "~", "…": "...", "✔": "yes", "✘": "no", "→": "->", "≥": ">=", "≤": "<=", "×": "x", "’": "'", "‘": "'", "“": '"', "”": '"', "▲": "^", "▼": "v" };

const clean = (s) => String(s).replace(/[^\x00-\xff]/g, (c) => SUB[c] ?? "?");
const esc = (s) => clean(s).replace(/([\\()])/g, "\\$1");
const num = (n) => (+n).toFixed(2);
const rgb = (hex) => [1, 3, 5].map((i) => num(parseInt(hex.slice(i, i + 2), 16) / 255)).join(" ");

export class Pdf {
  constructor(w = 842, h = 595) { this.w = w; this.h = h; this.ops = []; this.images = []; }
  // All y values are measured from the TOP of the page.
  rect(x, y, w, h, fill) { this.ops.push(`${rgb(fill)} rg ${num(x)} ${num(this.h - y - h)} ${num(w)} ${num(h)} re f`); }
  text(x, y, str, size = 10, color = "#e6eef7", bold = false) {
    this.ops.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${rgb(color)} rg ${num(x)} ${num(this.h - y - size)} Td (${esc(str)}) Tj ET`);
  }
  // Greedy word wrap using an average Helvetica glyph width; returns the y after the last line.
  paragraph(x, y, width, str, size = 9, color = "#c8d7e8", lead = 1.35, maxLines = 99) {
    const per = Math.max(10, Math.floor(width / (size * 0.5)));
    let lines = [];
    for (const para of clean(str).split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/)) {
        if ((line + " " + word).trim().length > per) { lines.push(line); line = word; } else line = (line + " " + word).trim();
      }
      lines.push(line);
    }
    if (lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1] = lines[maxLines - 1].replace(/.{0,3}$/, "..."); }
    lines.forEach((l, i) => this.text(x, y + i * size * lead, l, size, color));
    return y + lines.length * size * lead;
  }
  // dataUrl must be a JPEG. Scaled to fit (contain) and centred in the box.
  image(dataUrl, srcW, srcH, x, y, w, h) {
    const bin = atob(dataUrl.split(",")[1]), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const k = Math.min(w / srcW, h / srcH), dw = srcW * k, dh = srcH * k;
    this.images.push({ bytes, w: srcW, h: srcH });
    const name = `Im${this.images.length}`;
    this.ops.push(`q ${num(dw)} 0 0 ${num(dh)} ${num(x + (w - dw) / 2)} ${num(this.h - y - h + (h - dh) / 2)} cm /${name} Do Q`);
  }

  toBlob() {
    const enc = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 255);
    const chunks = [], offsets = [];
    let len = 0;
    const push = (b) => { const u = typeof b === "string" ? enc(b) : b; chunks.push(u); len += u.length; };
    const obj = (n, body) => { offsets[n] = len; push(`${n} 0 obj\n`); body(); push("\nendobj\n"); };
    const nImg = this.images.length, first = 6; // objects 1-5 fixed, images from 6
    const content = enc(this.ops.join("\n"));
    push("%PDF-1.4\n");
    obj(1, () => push("<< /Type /Catalog /Pages 2 0 R >>"));
    obj(2, () => push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"));
    const xo = this.images.map((_, i) => `/Im${i + 1} ${first + i} 0 R`).join(" ");
    obj(3, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${this.w} ${this.h}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 ${first + nImg} 0 R >> /XObject << ${xo} >> >> >>`));
    obj(4, () => { push(`<< /Length ${content.length} >>\nstream\n`); push(content); push("\nendstream"); });
    obj(5, () => push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"));
    this.images.forEach((im, i) => obj(first + i, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>\nstream\n`);
      push(im.bytes); push("\nendstream");
    }));
    obj(first + nImg, () => push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"));
    const total = first + nImg + 1, xref = len;
    push(`xref\n0 ${total}\n0000000000 65535 f \n`);
    for (let i = 1; i < total; i++) push(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
    push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
    return new Blob(chunks, { type: "application/pdf" });
  }
}
