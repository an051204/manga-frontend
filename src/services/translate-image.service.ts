import { GoogleGenerativeAI } from "@google/generative-ai";
import sharp from "sharp";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { translate } from "google-translate-api-x";
import { env } from "../config/env";
import { ApiError } from "../utils/api-error";
import { extractJsonText } from "../utils/json-parser";
import { TranslateImageResponse } from "../types/translate-image";
import {
  resolveTypesettingMetadata,
  getSourceLanguageLabel,
  buildBubbleUserPrompt,
  parseBubbleTranslations,
} from "../utils/typesetting";
import prisma from "../prisma/client";
import { logger } from "../utils/logger";
import { HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import { detectSpeechBubbles, validateBubbles } from "./speech-bubble-detection";
import { ocrMultipleBubbles, mergeBubbleTexts, BubbleOcrResult } from "./per-bubble-ocr";
import { ComicLayout, sortBubbleResults } from "../utils/reading-order";
import { processDocumentOcr } from "./document-ocr.service";
import { calibrateBubbleLanguage } from "./bubble-calibration.service";
import { renderTranslatedImage, renderTranslatedDocumentImage } from "./image-renderer.service";

const normalizeTargetLanguageCode = (targetLang: string): string => {
  const t = targetLang.trim().toLowerCase();
  if (t === "vietnamese" || t === "vie" || t === "vi") return "vi";
  if (t === "english" || t === "eng" || t === "en") return "en";
  if (t === "japanese" || t === "jpn" || t === "ja") return "ja";
  if (t === "korean" || t === "kor" || t === "ko") return "ko";
  if (t === "chinese" || t === "chi_sim" || t === "zh" || t === "zh-cn") return "zh-CN";
  return "vi";
};

const resolveComicLayout = (sourceLanguage: string, requestedLayout?: string): ComicLayout => {
  const normalizedLayout = requestedLayout?.trim().toLowerCase();
  const layouts: ComicLayout[] = ["manga", "manhua_classic", "manhua_modern", "webtoon", "comic"];
  if (normalizedLayout && layouts.includes(normalizedLayout as ComicLayout)) return normalizedLayout as ComicLayout;

  switch (sourceLanguage.trim().toLowerCase()) {
    case "jpn": case "japanese": return "manga";
    case "chi_tra": case "chi_sim": return "manhua_modern";
    case "kor": case "korean": return "webtoon";
    default: return "comic";
  }
};

const MANUAL_OCR_LANGUAGE_ALIASES: Record<string, string> = {
  auto: "auto", eng: "eng", english: "eng", "eng+vie": "eng+vie",
  jpn: "jpn_vert", japanese: "jpn_vert", jpn_vert: "jpn_vert",
  chi_sim: "chi_sim_vert", "chinese simplified": "chi_sim_vert", zhs: "chi_sim_vert", chi_sim_vert: "chi_sim_vert",
  chi_tra: "chi_tra_vert", "chinese traditional": "chi_tra_vert", zht: "chi_tra_vert", cht: "chi_tra_vert", chi_tra_vert: "chi_tra_vert",
  kor: "kor", korean: "kor", kor_vert: "kor",
};

const resolveManualOcrLanguage = (sourceLanguage: string): string => {
  return MANUAL_OCR_LANGUAGE_ALIASES[sourceLanguage.trim().toLowerCase()] ?? sourceLanguage.trim();
};

const systemPrompt = (targetLanguage: string, isMangaMode: boolean, sourceLanguage: string = ""): string => {
  if (isMangaMode) {
    const srcLabel = getSourceLanguageLabel(sourceLanguage);
    return `Bạn là chuyên gia dịch truyện tranh (Manga, Manhwa, Manhua, Comic).\nNgôn ngữ nguồn: ${srcLabel}.\nNgôn ngữ đích: ${targetLanguage}.\nNhiệm vụ: Sửa lỗi OCR và dịch sang ${targetLanguage} với văn phong tự nhiên.\nQUY TẮC:\n1. Sửa lỗi OCR.\n2. Giữ nguyên ngữ điệu.\n3. SFX: Dịch kèm hoặc phiên âm.\n4. Trả về đúng format [BUBBLE_N].\n5. Đọc theo chuẩn Comic Format.\nTrả về JSON:\n{"status":"success","data":{"detected_source_language":"...","original_ocr_text":"...","reconstructed_text":"...","translated_text":"...","confidence_score":"..."}}`;
  }
  return `Bạn là công cụ dịch thuật tài liệu và văn bản chuyên nghiệp.\nNgôn ngữ đích: ${targetLanguage}.\nNhiệm vụ: Phân tích, sửa lỗi OCR và dịch chính xác sang ${targetLanguage} với văn phong mạch lạc, chuẩn ngữ cảnh.\nQUY TẮC:\n1. Nếu nhận danh sách có đánh dấu [BUBBLE_N], hãy dịch từng đoạn và trả về đúng format [BUBBLE_N].\n2. Trong "original_ocr_text", ghép tất cả text gốc lại.\n3. Trong "reconstructed_text", ghép tất cả text đã sửa lỗi lại.\n4. CHỈ trả về JSON:\n{"status":"success","data":{"detected_source_language":"...","original_ocr_text":"...","reconstructed_text":"...","translated_text":"...","confidence_score":"..."}}`;
};

const buildUserPrompt = (rawText: string): string => `Day la van ban OCR raw can xu ly:\n\n${rawText}`.trim();
const normalizeGeminiJson = (text: string): string => text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").replace(/,\s*([}\]])/g, "$1");

const parseJsonSafely = (text: string): TranslateImageResponse => {
  const candidates = [text, normalizeGeminiJson(text)];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as any;
      if (parsed?.status === "success" && parsed.data?.translated_text) {
        return {
          status: "success",
          data: {
            detected_source_language: parsed.data.detected_source_language || "",
            original_ocr_text: parsed.data.original_ocr_text || "",
            reconstructed_text: parsed.data.reconstructed_text || "",
            translated_text: parsed.data.translated_text || "",
            confidence_score: String(parsed.data.confidence_score || "0"),
          },
        };
      }
    } catch (error) { }
  }
  throw new Error("Cau truc JSON tra ve tu LLM khong dung yeu cau.");
};

const parseGeminiResponse = (text: string): TranslateImageResponse => parseJsonSafely(extractJsonText(text));

export const translateImageService = async (
  imageBuffer: Buffer,
  originalName: string | undefined,
  sourceLanguage: string,
  targetLanguage: string,
  ocrEngineModeInput: number | null,
  requestedLayout?: string,
): Promise<TranslateImageResponse> => {
  let ocrEngineMode = ocrEngineModeInput;
  if (!env.geminiApiKey) throw new ApiError("Thieu GEMINI_API_KEY trong file .env.", 500);

  try {
    const manualSourceLanguage = resolveManualOcrLanguage(sourceLanguage);
    let comicLayout = resolveComicLayout(manualSourceLanguage, requestedLayout);
    const isAutoMode = manualSourceLanguage === "auto";
    let effectiveSourceLanguage = manualSourceLanguage;

    if (isAutoMode && ocrEngineMode === null) ocrEngineMode = 11;

    let rawOcrText = "";
    let storedBubbleOcrResults: BubbleOcrResult[] = [];
    let pageOcrConfidence: number | null = null;
    let isDocumentMode = ocrEngineMode !== 11;

    if (ocrEngineMode === 11) {
      try {
        let bubbles = await detectSpeechBubbles(imageBuffer);
        if (!validateBubbles(bubbles)) throw new Error("Bubble boxes không hợp lệ");

        let imgW = 1; let imgH = 1;

        if (bubbles.length > 0) {
          const metadata = await sharp(imageBuffer).metadata();
          imgW = metadata.width || 1;
          imgH = metadata.height || 1;
          const imgArea = imgW * imgH;
          const totalBubbleArea = bubbles.reduce((sum, b) => sum + (b.w * b.h), 0);

          const hasGiantBubble = bubbles.some(b => (b.w * b.h) > imgArea * 0.35);
          const hasTooManyBubbles = bubbles.length >= 50;
          const wideBubblesCount = bubbles.filter(b => b.w / Math.max(1, b.h) > 4.0).length;
          const isTextLines = bubbles.length > 3 && (wideBubblesCount / bubbles.length) >= 0.8;
          const isSparseTestImage = bubbles.length <= 3 && (totalBubbleArea / imgArea) < 0.05;
          const isSolitaryTextBlock = bubbles.length <= 3 && (totalBubbleArea / imgArea) > 0.15;

          if (totalBubbleArea > imgArea * 0.50 || hasGiantBubble || hasTooManyBubbles || isSparseTestImage || isTextLines || isSolitaryTextBlock) {
            logger.warn(`[ROUTER] Nhận diện đặc trưng Tài Liệu Thuần! Chuyển sang Document Mode.`);
            bubbles = [];
          }
        }

        if (bubbles.length === 0) {
          isDocumentMode = true;
        } else {
          let selectedBubbleLanguage = manualSourceLanguage;
          if (isAutoMode) {
            const calib = await calibrateBubbleLanguage(imageBuffer, bubbles);
            selectedBubbleLanguage = calib.selectedBubbleLanguage;
            effectiveSourceLanguage = calib.effectiveSourceLanguage;
            comicLayout = resolveComicLayout(effectiveSourceLanguage, requestedLayout);
            if (effectiveSourceLanguage === "jpn") comicLayout = "manga";
          }

          const bubbleOcrResults = await ocrMultipleBubbles(imageBuffer, bubbles, selectedBubbleLanguage, true);

          const filteredBubbleResults = bubbleOcrResults.filter(r => {
            const text = r.text.replace(/\s/g, "");
            if (text.length < 1) return false;
            const validChars = (text.match(/[\p{L}\p{N}]/gu) ?? []).length;
            const noiseChars = (text.match(/[|\\/\[\]{}<>~`^=_¿¬"']/g) ?? []).length;
            return validChars >= 1 && noiseChars <= validChars * 2;
          });

          const orderedBubbleOcrResults = sortBubbleResults(filteredBubbleResults, comicLayout);
          rawOcrText = mergeBubbleTexts(orderedBubbleOcrResults);
          storedBubbleOcrResults = orderedBubbleOcrResults;
        }
      } catch (bubbleError) {
        logger.warn("[BUBBLE-OCR] CV Service lỗi, tự động fallback sang Document Mode.");
        isDocumentMode = true;
      }
    }

    if (isDocumentMode) {
      const docResult = await processDocumentOcr(imageBuffer, manualSourceLanguage);
      rawOcrText = docResult.text;
      effectiveSourceLanguage = docResult.language;
      pageOcrConfidence = docResult.confidence;
      comicLayout = resolveComicLayout(effectiveSourceLanguage, requestedLayout);

      // Lưu trữ tọa độ các khối văn bản/đoạn văn để phục vụ dịch và render từng khối
      if (docResult.blocks && docResult.blocks.length > 0) {
        storedBubbleOcrResults = docResult.blocks.map((b) => ({
          bbox: {
            x: b.bbox.xmin,
            y: b.bbox.ymin,
            w: b.bbox.xmax - b.bbox.xmin,
            h: b.bbox.ymax - b.bbox.ymin,
          },
          text: b.text,
          confidence: b.confidence,
          processingTimeMs: 0,
        }));
        logger.info(`[DOCUMENT-MODE] Tìm thấy ${storedBubbleOcrResults.length} khối văn bản có tọa độ trên trang.`);
      }
    }

    if (!rawOcrText) throw new ApiError("Khong the trich xuat text tu anh. Anh chua ro hoac he thong OCR that bai.", 422, "OCR_LOW_CONFIDENCE");

    const isMangaMode = !isDocumentMode;
    const genAI = new GoogleGenerativeAI(env.geminiApiKey);
    const model = genAI.getGenerativeModel({
      model: env.geminiModel,
      systemInstruction: systemPrompt(targetLanguage, isMangaMode, effectiveSourceLanguage),
      generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
      ],
    });

    let truncatedOcrText = rawOcrText.length > 8000 ? rawOcrText.substring(0, 8000) : rawOcrText;
    let parsed: TranslateImageResponse;

    try {
      const userPrompt = storedBubbleOcrResults.length > 0
        ? buildBubbleUserPrompt(storedBubbleOcrResults)
        : buildUserPrompt(truncatedOcrText);

      // Giới hạn thời gian gọi Gemini tối đa 6.5 giây để tránh Vercel timeout 10s
      const geminiPromise = model.generateContent(userPrompt);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Gemini API timeout (6.5s)")), 6500)
      );

      const response = (await Promise.race([geminiPromise, timeoutPromise])) as any;
      parsed = parseGeminiResponse(response.response.text());
    } catch (llmError) {
      const errorMessage = llmError instanceof Error ? llmError.message : String(llmError);
      logger.warn(`[LLM-FALLBACK] Gemini API gặp lỗi (${errorMessage}). Đang kích hoạt Google Translate dự phòng...`);

      try {
        const toLang = normalizeTargetLanguageCode(targetLanguage);
        let fallbackTranslatedText = "";

        if (storedBubbleOcrResults.length > 0) {
          // Dịch mảng các bubble/block bằng Google Translate
          const textsToTranslate = storedBubbleOcrResults.map((b) => b.text || " ");
          const gtRes = await translate(textsToTranslate, { to: toLang });
          const gtArray = Array.isArray(gtRes) ? gtRes : [gtRes];
          const perBubbleTranslations = gtArray.map((r: any) => (r && r.text ? r.text : ""));

          fallbackTranslatedText = perBubbleTranslations
            .map((txt: string, idx: number) => `[BUBBLE_${idx}] ${txt}`)
            .join("\n");
        } else {
          // Dịch toàn bộ văn bản raw
          const gtRes = await translate(truncatedOcrText, { to: toLang });
          fallbackTranslatedText = Array.isArray(gtRes)
            ? gtRes.map((r: any) => r.text).join("\n")
            : (gtRes as any).text;
        }

        logger.info(`[LLM-FALLBACK] Dịch dự phòng Google Translate thành công!`);
        parsed = {
          status: "success",
          data: {
            detected_source_language: getSourceLanguageLabel(effectiveSourceLanguage),
            original_ocr_text: rawOcrText,
            reconstructed_text: rawOcrText,
            translated_text: fallbackTranslatedText,
            confidence_score: "0.9",
          },
        };
      } catch (gtError) {
        const gtErrorMessage = gtError instanceof Error ? gtError.message : String(gtError);
        logger.error(`[LLM-FALLBACK] Cả Gemini và Google Translate đều thất bại: ${gtErrorMessage}`);
        parsed = {
          status: "success",
          data: {
            detected_source_language: getSourceLanguageLabel(effectiveSourceLanguage),
            original_ocr_text: rawOcrText,
            reconstructed_text: rawOcrText,
            translated_text: `[LỖI API DỊCH]: ${errorMessage} | Fallback: ${gtErrorMessage}`,
            confidence_score: "0",
          },
        };
      }
    }

    parsed.data.detected_source_language = getSourceLanguageLabel(effectiveSourceLanguage);
    const bubbleConfidence = storedBubbleOcrResults.length > 0 ? storedBubbleOcrResults.reduce((t, r) => t + (r.confidence ?? 0), 0) / storedBubbleOcrResults.length : null;
    parsed.data.ocr_confidence = bubbleConfidence ?? pageOcrConfidence ?? undefined;
    parsed.data.comic_format = isDocumentMode ? "document" : comicLayout;

    if (isMangaMode) {
      parsed.data.typesetting_metadata = resolveTypesettingMetadata(effectiveSourceLanguage);
    } else {
      parsed.data.typesetting_metadata = {
        direction: "horizontal-tb",
        alignment: "left",
        comic_format: "document",
      };
    }

    if (storedBubbleOcrResults.length > 0) {
      const isTranslationError = parsed.data.translated_text.startsWith("[LỖI API DỊCH]");
      const perBubbleTranslations = isTranslationError ? [] : parseBubbleTranslations(parsed.data.translated_text, storedBubbleOcrResults.length);
      parsed.data.bubbles = storedBubbleOcrResults.map((result, idx) => ({
        bbox: { xmin: result.bbox.x, ymin: result.bbox.y, xmax: result.bbox.x + result.bbox.w, ymax: result.bbox.y + result.bbox.h },
        original_text: result.text,
        translated_text: isTranslationError ? parsed.data.translated_text : (perBubbleTranslations[idx] || ""),
        confidence: result.confidence,
      }));
    }

    // ✅ Render ảnh đã dịch nếu Gemini dịch thành công (Manga bubbles hoặc Document Mode)
    try {
      let finalRenderedBuffer: Buffer | null = null;

      if (parsed.data.bubbles && parsed.data.bubbles.length > 0) {
        finalRenderedBuffer = await renderTranslatedImage(imageBuffer, {
          bubbles: parsed.data.bubbles,
          typesetting: parsed.data.typesetting_metadata,
          isDocumentMode,
        });
        parsed.data.translated_image_base64 = finalRenderedBuffer.toString("base64");
        logger.info(`[IMAGE-RENDER] Đã render ảnh dịch ${isDocumentMode ? "Document Blocks" : "Manga/Comic"} (${parsed.data.translated_image_base64.length} chars base64).`);
      } else if (parsed.data.translated_text && !parsed.data.translated_text.startsWith("[LỖI API DỊCH]")) {
        finalRenderedBuffer = await renderTranslatedDocumentImage(imageBuffer, parsed.data.translated_text);
        parsed.data.translated_image_base64 = finalRenderedBuffer.toString("base64");
        logger.info(`[IMAGE-RENDER] Đã render ảnh dịch Document Full-page (${parsed.data.translated_image_base64.length} chars base64).`);
      }

      // Lưu tự động một bản copy vào thư mục local 'uploads/translated/'
      if (finalRenderedBuffer) {
        try {
          const outDir = join(process.cwd(), "uploads", "translated");
          if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
          const safeFileName = `translated_${Date.now()}_${(originalName || "image.png").replace(/[^a-zA-Z0-9._-]/g, "_")}`;
          writeFileSync(join(outDir, safeFileName), finalRenderedBuffer);
          logger.info(`[LOCAL-SAVE] Đã lưu bản sao ảnh dịch tại: uploads/translated/${safeFileName}`);
        } catch (fsErr) {
          logger.warn(`[LOCAL-SAVE] Không thể lưu file local: ${fsErr}`);
        }
      }
    } catch (renderError) {
      logger.error(`[IMAGE-RENDER] Lỗi render ảnh: ${renderError instanceof Error ? renderError.message : String(renderError)}`);
    }

    prisma.translationHistory.create({
      data: {
        image_name: originalName ?? "unknown_image",
        original_ocr_text: parsed.data.original_ocr_text,
        translated_text: parsed.data.translated_text,
        source_language: effectiveSourceLanguage,
        target_language: targetLanguage,
        confidence_score: parsed.data.confidence_score,
      },
    }).catch(e => logger.error("DB Save failed", e));

    return parsed;
  } catch (error) {
    throw new ApiError(`Xu ly OCR/LLM that bai: ${error instanceof Error ? error.message : "Loi khong xac dinh."}`, 500);
  }
};