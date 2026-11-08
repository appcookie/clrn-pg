import { PNG } from 'pngjs';

export function fillPNG(png, color) {
  for (let offset = 0; offset < png.data.length; offset += 4) png.data.set(color, offset);
}
export function paintRect(png, bounds, color) {
  for (let y = bounds.y; y < bounds.y + bounds.height; y++)
    for (let x = bounds.x; x < bounds.x + bounds.width; x++) png.data.set(color, (y * png.width + x) * 4);
}
function drawingFor(phase, auto, controls) {
  return phase === 'start' ? auto : phase === 'removed' ? [] : controls;
}
function scaleFor(phase, cut) {
  return phase === 'middle' && !cut ? .6 : 1;
}
function hardCutButton(hardCut, index) {
  return hardCut && index === 5;
}
function buttonColor(phase, index) {
  return phase === 'start' ? [120, 140, 130, 255] : [230, 100 + index * 10, 15, 255];
}
export function operationImage(screen, auto, controls, phase, hardCut = false) {
  const png = new PNG(screen);
  fillPNG(png, [20, 90, 70, 255]);
  for (const [index, control] of drawingFor(phase, auto, controls).entries()) {
    const b = control.bounds, factor = scaleFor(phase, hardCutButton(hardCut, index));
    const width = Math.round(b.width * factor), height = Math.round(b.height * factor);
    const x = b.x + Math.floor((b.width - width) / 2), y = b.y + Math.floor((b.height - height) / 2);
    paintRect(png, { x, y, width, height }, buttonColor(phase, index));
  }
  return PNG.sync.write(png);
}
