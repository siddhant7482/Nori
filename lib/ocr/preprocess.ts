import sharp from "sharp";

/**
 * Image preparation for Tesseract.
 *
 * This stage buys more accuracy than any amount of prompt tuning downstream.
 * Tesseract was built for scanned documents; a handheld phone photo of glossy
 * thermal paper is nothing like its training distribution, and feeding one in
 * raw produces text that no model can rescue.
 */

export type PreprocessResult = {
  /** Lossless PNG, ready for recognition. */
  image: Buffer;
  width: number;
  height: number;
  /** True when the source was upscaled rather than downscaled. */
  upscaled: boolean;
};

/** Tesseract wants roughly 300 DPI. For a receipt this lands near 2000px tall. */
const TARGET_HEIGHT = 2000;
const MIN_HEIGHT = 900;

export async function preprocessReceipt(
  input: Buffer,
): Promise<PreprocessResult> {
  const source = sharp(input, { failOn: "none" }).rotate(); // honour EXIF
  const meta = await source.metadata();

  if (!meta.width || !meta.height) {
    throw new Error("Could not read image dimensions — file may be corrupt.");
  }

  // Receipts are tall and narrow, so height is the axis that determines
  // whether glyphs land above Tesseract's legibility floor.
  const upscaled = meta.height < MIN_HEIGHT;
  const targetHeight = Math.min(
    Math.max(meta.height, MIN_HEIGHT),
    TARGET_HEIGHT,
  );

  const image = await source
    .resize({
      height: targetHeight,
      fit: "inside",
      // A too-small photo is better interpolated than left illegible, so
      // enlargement is allowed — but only up to MIN_HEIGHT.
      withoutEnlargement: !upscaled,
      kernel: "lanczos3",
    })
    .greyscale()
    // Stretch the histogram: thermal receipts fade to low-contrast grey, and
    // normalising recovers separation between ink and paper.
    .normalise()
    .sharpen({ sigma: 1 })
    .png({ compressionLevel: 6 })
    .toBuffer({ resolveWithObject: true });

  return {
    image: image.data,
    width: image.info.width,
    height: image.info.height,
    upscaled,
  };
}

/**
 * Prepares an image for a vision model — deliberately the opposite of the
 * treatment above.
 *
 * Tesseract wants a hard, high-contrast, greyscale bitmap. A vision model
 * wants something closer to what a person would see: colour retained (ink
 * hue and paper tone carry real signal), no aggressive thresholding, and no
 * sharpening halos that read as artefacts. The only jobs here are to fix
 * orientation and to keep the payload small enough not to waste tokens.
 */
export async function prepareForVision(input: Buffer): Promise<{
  dataUrl: string;
  bytes: number;
}> {
  // ~1600px on the long edge keeps small print legible while staying near the
  // resolution the model tiles at anyway — larger costs tokens for nothing.
  const jpeg = await sharp(input, { failOn: "none" })
    .rotate()
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();

  return {
    dataUrl: `data:image/jpeg;base64,${jpeg.toString("base64")}`,
    bytes: jpeg.length,
  };
}

/** Small, cheap JPEG for list rows and the review pane. */
export async function makeThumbnail(input: Buffer): Promise<Buffer> {
  return sharp(input, { failOn: "none" })
    .rotate()
    .resize({ width: 400, height: 560, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 72, mozjpeg: true })
    .toBuffer();
}
