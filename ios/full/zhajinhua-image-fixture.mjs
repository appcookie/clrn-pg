// Synthetic canvases only; never native evidence or baseline candidates.
import { PNG } from 'pngjs';

export function solidImage(size, color) {
  const png = new PNG(size);
  for (let offset = 0; offset < png.data.length; offset += 4) png.data.set(color, offset);
  return png;
}

export function paintRectangle(png, bounds, pixel) {
  for (let y = bounds.y; y < bounds.y + bounds.height; y++)
    for (let x = bounds.x; x < bounds.x + bounds.width; x++)
      png.data.set(pixel(x, y), (y * png.width + x) * 4);
}

export function mapRgb(png, transform) {
  for (let offset = 0; offset < png.data.length; offset += 4)
    for (let channel = 0; channel < 3; channel++)
      png.data[offset + channel] = transform(png.data[offset + channel]);
}

export async function withSmokeMode(run) {
  const previous = process.env.IOS_VISUAL_MODE;
  process.env.IOS_VISUAL_MODE = 'smoke';
  try { return await run(); }
  finally {
    if (previous === undefined) delete process.env.IOS_VISUAL_MODE;
    else process.env.IOS_VISUAL_MODE = previous;
  }
}
