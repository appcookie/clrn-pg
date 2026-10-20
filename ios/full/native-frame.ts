import sharp from 'sharp';

export type FramePixels = { width: number; height: number; data: Buffer };

/** Lossless RGBA decoding on the native worker pool; no resize or palette conversion. */
export async function decodeFrame(bytes: Buffer): Promise<FramePixels> {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 4) throw new Error('动画帧必须解码为 RGBA');
  return { width: info.width, height: info.height, data };
}

export async function encodeFrame(frame: FramePixels): Promise<Buffer> {
  return sharp(frame.data, { raw: { width: frame.width, height: frame.height, channels: 4 } })
    .png({ compressionLevel: 1, palette: false }).toBuffer();
}
