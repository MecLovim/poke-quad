// Gera build/icon.png (1024x1024) com o mesmo desenho do ícone SVG da barra
// de título: círculo bipartido (topo vermelho, base clara), faixa escura no
// meio e círculo claro central com miolo amarelo. Sem dependências externas.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 1024;
const SS = 3; // amostras de anti-aliasing por eixo

// Mesmas proporções do SVG (viewBox 24)
const u = SIZE / 24;
const cx = SIZE / 2;
const cy = SIZE / 2;
const OUTER_R = 11 * u;
const OUTER_STROKE = 1.5 * u;
const INNER_R = 4 * u;
const INNER_STROKE = 1.5 * u;
const CORE_R = 1.8 * u;
const BAND_HALF = 1.5 * u;

const RED = [227, 53, 13];      // #e3350d
const LIGHT = [232, 237, 243];  // #e8edf3
const DARK = [27, 36, 48];      // #1b2430
const YELLOW = [255, 203, 5];   // #ffcb05

function colorAt(x, y) {
  const dx = x - cx;
  const dy = y - cy;
  const d = Math.hypot(dx, dy);
  if (d > OUTER_R + OUTER_STROKE / 2) return null;
  if (d > OUTER_R - OUTER_STROKE / 2) return DARK;
  if (d <= CORE_R) return YELLOW;
  if (d <= INNER_R - INNER_STROKE / 2) return LIGHT;
  if (d <= INNER_R + INNER_STROKE / 2) return DARK;
  if (Math.abs(dy) <= BAND_HALF) return DARK;
  return dy < 0 ? RED : LIGHT;
}

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
const samples = SS * SS;

for (let y = 0; y < SIZE; y++) {
  const rowStart = y * (SIZE * 4 + 1);
  raw[rowStart] = 0; // filtro "None"
  for (let x = 0; x < SIZE; x++) {
    let r = 0;
    let g = 0;
    let b = 0;
    let hits = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const c = colorAt(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS);
        if (c) {
          r += c[0];
          g += c[1];
          b += c[2];
          hits++;
        }
      }
    }
    const i = rowStart + 1 + x * 4;
    if (hits > 0) {
      raw[i] = Math.round(r / hits);
      raw[i + 1] = Math.round(g / hits);
      raw[i + 2] = Math.round(b / hits);
      raw[i + 3] = Math.round((255 * hits) / samples);
    }
  }
}

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
]);

const out = path.join(__dirname, 'icon.png');
fs.writeFileSync(out, png);
console.log(`Gerado ${out} (${SIZE}x${SIZE}, ${png.length} bytes)`);
