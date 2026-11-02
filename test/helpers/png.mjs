import { crc32, deflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const chunk = (type, body) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type), body]);
  const check = Buffer.alloc(4);
  check.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, check]);
};

/** An 8-bit RGBA PNG. `pixel(x, y)` gives [red, green, blue, alpha]. */
export const png = (width, height, pixel = () => [200, 100, 50, 255]) => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      rows.set(pixel(x, y), y * (width * 4 + 1) + 1 + x * 4);
    }
  }
  return Buffer.concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
};
