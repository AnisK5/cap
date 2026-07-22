// Génère les icônes PWA en PNG pur (zlib + struct, aucune dépendance) :
// fond indigo « cap », chevron blanc pointé vers le haut (le cap qu'on tient).
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const INDIGO = [75, 73, 200]; // --color-cap #4b49c8
const WHITE = [255, 255, 255];

function crc32(buf) {
  let c, table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// Le chevron : pour un pixel (x,y) en coordonnées [0,1], est-il dans le « ^ » ?
function inChevron(x, y) {
  const cx = 0.5;
  const apexY = 0.30, baseY = 0.72, thickness = 0.16;
  const dx = Math.abs(x - cx);
  const outer = apexY + dx * ((baseY - apexY) / 0.26);
  const inner = outer + thickness;
  return y >= outer && y <= inner && dx <= 0.26;
}

function makePng(size, { maskable = false } = {}) {
  const rows = [];
  const pad = maskable ? 0.10 : 0; // zone de sécurité maskable
  for (let py = 0; py < size; py++) {
    const row = [0]; // filtre none
    for (let px = 0; px < size; px++) {
      const x = px / size, y = py / size;
      const sx = (x - pad) / (1 - 2 * pad), sy = (y - pad) / (1 - 2 * pad);
      const c =
        sx >= 0 && sx <= 1 && sy >= 0 && sy <= 1 && inChevron(sx, sy)
          ? WHITE
          : INDIGO;
      row.push(c[0], c[1], c[2]);
    }
    rows.push(Buffer.from(row));
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync("public/icons", { recursive: true });
writeFileSync("public/icons/icon-192.png", makePng(192));
writeFileSync("public/icons/icon-512.png", makePng(512));
writeFileSync("public/icons/icon-maskable-512.png", makePng(512, { maskable: true }));
writeFileSync("public/icons/apple-touch-icon.png", makePng(180));
console.log("icônes générées");
