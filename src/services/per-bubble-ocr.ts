import sharp from "sharp";
import Tesseract from "tesseract.js";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { logger } from "../utils/logger";
import { BubbleBox } from "./speech-bubble-detection";

export interface BubbleOcrResult {
  text: string;
  bbox: BubbleBox;
  confidence?: number;
  processingTimeMs: number;
}

const BUBBLE_PADDING_PX = 5;
const OCR_DATA_DIR = join(process.cwd(), "traineddata");

const OCR_WORKER_OPTIONS = {
  langPath: OCR_DATA_DIR,
  cachePath: OCR_DATA_DIR,
  cacheMethod: "none" as const,
  gzip: false,
};

export const cleanCjkOcrText = (rawText: string): string => {
  let cleaned = rawText.replace(/[a-zA-Z0-9\[\]\{\}\<\>\|\~\%\¢\(\)\_\-\@\#\$\^\&\*]/g, "");
  return cleaned.replace(/\s+/g, " ").trim();
};

export const ocrSingleBubble = async (imageBuffer: Buffer, bbox: BubbleBox, language: string): Promise<BubbleOcrResult> => {
  const startTime = Date.now();
  let worker: Tesseract.Worker | null = null;

  try {
    const metadata = await sharp(imageBuffer).metadata();
    const imgW = metadata.width || 0;
    const imgH = metadata.height || 0;

    const cropX = Math.max(0, bbox.x - BUBBLE_PADDING_PX);
    const cropY = Math.max(0, bbox.y - BUBBLE_PADDING_PX);
    const cropW = Math.min(imgW - cropX, bbox.w + BUBBLE_PADDING_PX * 2);
    const cropH = Math.min(imgH - cropY, bbox.h + BUBBLE_PADDING_PX * 2);

    const croppedBuffer = await sharp(imageBuffer)
      .extract({ left: cropX, top: cropY, width: cropW, height: cropH })
      .toBuffer();

    const upscaledBuffer = await sharp(croppedBuffer)
      .resize(cropW * 3, cropH * 3, { kernel: sharp.kernel.lanczos3, fit: "fill", withoutEnlargement: false })
      .grayscale()
      .normalize()
      .toBuffer();

    const psmMode = language.includes("vert") ? Tesseract.PSM.SINGLE_BLOCK_VERT_TEXT : Tesseract.PSM.SINGLE_BLOCK;

    worker = await Tesseract.createWorker(language, 1, OCR_WORKER_OPTIONS);
    await worker.setParameters({ tessedit_pageseg_mode: psmMode });

    const recognitionResult = await worker.recognize(upscaledBuffer);
    let bestText = recognitionResult.data.text.trim();
    let bestConfidence = recognitionResult.data.confidence || 0;

    if (language.includes("jpn") || language.includes("chi")) bestText = cleanCjkOcrText(bestText);

    if (bestConfidence < 50) {
      const fallbackBuffer = await sharp(upscaledBuffer).threshold(160).toBuffer();
      const fallbackResult = await worker.recognize(fallbackBuffer);
      if ((fallbackResult.data.confidence || 0) > bestConfidence || !bestText) {
        bestText = fallbackResult.data.text.trim();
        bestConfidence = fallbackResult.data.confidence || 0;
      }
      if (language.includes("jpn") || language.includes("chi")) bestText = cleanCjkOcrText(bestText);
    }

    return { text: bestText, bbox, confidence: bestConfidence / 100, processingTimeMs: Date.now() - startTime };
  } catch (error) { throw error; }
  finally { if (worker) await worker.terminate(); }
};

export const ocrMultipleBubbles = async (imageBuffer: Buffer, bubbles: BubbleBox[], language: string, useParallel: boolean = false): Promise<BubbleOcrResult[]> => {
  if (bubbles.length === 0) return [];
  try {
    let results: BubbleOcrResult[] = [];
    if (useParallel) results = await Promise.all(bubbles.map((bbox) => ocrSingleBubble(imageBuffer, bbox, language)));
    else for (let i = 0; i < bubbles.length; i += 1) results.push(await ocrSingleBubble(imageBuffer, bubbles[i], language));
    return results;
  } catch (error) { throw error; }
};

export const mergeBubbleTexts = (results: BubbleOcrResult[]): string => {
  if (results.length === 0) return "";
  return results.map((r) => r.text).join("\n");
};

export const scoreCjkCandidate = (
  text: string,
  confidence: number,
  language: string,
): number => {
  const clean = text.trim();
  if (!clean) return Number.NEGATIVE_INFINITY;

  const validChars = (clean.match(/[\p{L}\p{N}]/gu) ?? []).length;
  const noiseChars = (clean.match(/[|\\/\[\]{}<>~`^=_¿¬"']/g) ?? []).length;

  if (validChars === 0 || noiseChars > validChars) {
    return Number.NEGATIVE_INFINITY;
  }

  const latin = (clean.match(/[a-zA-Z]/g) ?? []).length;
  const hangul = (clean.match(/[\uac00-\ud7af]/g) ?? []).length;
  const kana = (clean.match(/[\u3040-\u30ff]/g) ?? []).length;
  const han = (clean.match(/[\u3400-\u9fff]/g) ?? []).length;

  if (language.includes("kor")) {
    if (hangul <= 1 && clean.length <= 2) return Number.NEGATIVE_INFINITY;
    return hangul * (confidence / 100);
  }

  if (language.startsWith("jpn")) {
    // Kana gives big boost to Japanese
    return (kana * 10 + han) * (confidence / 100);
  }

  if (language.includes("chi")) {
    return han * (confidence / 100);
  }

  return (latin + han + kana + hangul) * (confidence / 100);
};