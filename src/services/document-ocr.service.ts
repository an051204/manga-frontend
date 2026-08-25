import Tesseract from "tesseract.js";
import sharp from "sharp";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { cleanCjkOcrText } from "./per-bubble-ocr";
import { logger } from "../utils/logger";
import type { DocumentBlock } from "../types/translate-image";

const OCR_DATA_DIR = join(process.cwd(), "traineddata");

const OCR_WORKER_OPTIONS = {
    langPath: OCR_DATA_DIR,
    cachePath: OCR_DATA_DIR,
    cacheMethod: "none" as const,
    gzip: false,
};

const hasOcrLanguageData = (language: string): boolean => {
    return language.split("+").every((lang) => existsSync(join(OCR_DATA_DIR, `${lang}.traineddata`)));
};

/**
 * Trích xuất danh sách các khối văn bản/đoạn văn kèm bounding box từ Tesseract result.
 */
const extractBlocksFromResult = (
    data: any,
    lang: string
): DocumentBlock[] => {
    if (!data || !data.blocks || !Array.isArray(data.blocks)) {
        return [];
    }

    const blocks: DocumentBlock[] = [];
    const isCjk = lang.includes("jpn") || lang.includes("chi");

    for (const block of data.blocks) {
        if (!block || !block.bbox) continue;

        // Nếu block có paragraphs con, ưu tiên lấy theo từng paragraph để chia khối chính xác
        const paragraphs = block.paragraphs && Array.isArray(block.paragraphs) && block.paragraphs.length > 0
            ? block.paragraphs
            : [block];

        for (const p of paragraphs) {
            if (!p || !p.bbox) continue;

            let text = (p.text || "").trim();
            if (isCjk) {
                text = cleanCjkOcrText(text);
            }

            // Loại bỏ khoảng trắng thừa
            text = text.replace(/[ \t]+/g, " ").trim();

            const width = (p.bbox.x1 || 0) - (p.bbox.x0 || 0);
            const height = (p.bbox.y1 || 0) - (p.bbox.y0 || 0);

            // Chỉ lấy block có kích thước tối thiểu và có chứa ký tự chữ/số thực tế
            const hasLetters = /[\p{L}\p{N}]/u.test(text);
            if (width >= 8 && height >= 8 && text.length > 0 && hasLetters) {
                blocks.push({
                    bbox: {
                        xmin: Math.max(0, p.bbox.x0),
                        ymin: Math.max(0, p.bbox.y0),
                        xmax: Math.max(p.bbox.x0 + 1, p.bbox.x1),
                        ymax: Math.max(p.bbox.y0 + 1, p.bbox.y1),
                    },
                    text,
                    confidence: (p.confidence || block.confidence || data.confidence || 0) / 100,
                });
            }
        }
    }

    // Sắp xếp các block theo thứ tự đọc từ trên xuống dưới, từ trái sang phải
    return blocks.sort((a, b) => {
        const yDiff = a.bbox.ymin - b.bbox.ymin;
        if (Math.abs(yDiff) > 15) {
            return yDiff;
        }
        return a.bbox.xmin - b.bbox.xmin;
    });
};

export const processDocumentOcr = async (
    imageBuffer: Buffer,
    manualLanguage: string
): Promise<{ text: string; language: string; confidence: number; blocks: DocumentBlock[] }> => {
    logger.info("[DOCUMENT-OCR] Bắt đầu quét văn bản thuần toàn trang...");

    const processedImage = await sharp(imageBuffer).grayscale().normalize().toBuffer();

    if (manualLanguage !== "auto" && manualLanguage !== "") {
        let worker: Tesseract.Worker | null = null;
        try {
            worker = await Tesseract.createWorker(manualLanguage, 1, OCR_WORKER_OPTIONS);
            await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.AUTO });
            const result = await (worker as any).recognize(processedImage, {}, { blocks: true });
            let text = result.data.text.trim();
            if (manualLanguage.includes("jpn") || manualLanguage.includes("chi")) text = cleanCjkOcrText(text);
            const blocks = extractBlocksFromResult(result.data, manualLanguage);
            return {
                text,
                language: manualLanguage,
                confidence: (result.data.confidence || 0) / 100,
                blocks,
            };
        } finally { if (worker) await worker.terminate(); }
    }

    // ✅ ĐẤU TRƯỜNG CÔNG BẰNG: Đọ điểm TẤT CẢ model trước khi chốt
    const engModel = hasOcrLanguageData("eng+vie") ? "eng+vie" : "eng";
    const candidates = [engModel, "kor", "jpn", "chi_sim"].filter(hasOcrLanguageData);

    let bestScore = -1;
    let bestLang = engModel;
    let bestText = "";
    let bestConf = 0;
    let bestBlocks: DocumentBlock[] = [];

    for (const lang of candidates) {
        let worker: Tesseract.Worker | null = null;
        try {
            worker = await Tesseract.createWorker(lang, 1, { ...OCR_WORKER_OPTIONS, logger: () => undefined });
            await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.AUTO });
            const result = await (worker as any).recognize(processedImage, {}, { blocks: true });

            const text = result.data.text.trim();
            const conf = (result.data.confidence || 0) / 100;

            const latin = (text.match(/[a-zA-Z]/g) ?? []).length;
            const hangul = (text.match(/[\uac00-\ud7af]/g) ?? []).length;
            const kana = (text.match(/[\u3040-\u30ff]/g) ?? []).length;
            const han = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
            const valid = latin + hangul + kana + han;

            let score = 0;

            // Công thức: Ưu tiên model nhận diện đúng đặc trưng ngôn ngữ của nó
            if (lang === engModel) {
                if (hangul > 0 || kana > 0 || han > 0) score = 0;
                else score = latin * conf;
            } else if (lang === "kor") {
                score = hangul * conf;
                if (valid > 0 && hangul / valid < 0.2) score *= 0.1; // Phạt nặng nếu tiếng Hàn chỉ chiếm < 20% (Ảo giác)
            } else if (lang === "jpn") {
                score = (kana * 2 + han) * conf;
                if (kana === 0 && han > 0) score *= 0.1; // Chống cướp giải của Tiếng Trung
            } else if (lang === "chi_sim") {
                score = han * conf;
                if (kana > 0 || hangul > 0) score *= 0.1; // Phạt nếu ảo giác ra Nhật/Hàn
            }

            if (score > bestScore) {
                bestScore = score;
                bestLang = lang;
                bestText = text;
                bestConf = conf;
                bestBlocks = extractBlocksFromResult(result.data, lang);
            }
        } finally { if (worker) await worker.terminate(); }
    }

    if (bestLang === "jpn" || bestLang === "chi_sim") bestText = cleanCjkOcrText(bestText);
    if (bestLang === "kor" && hasOcrLanguageData("kor+eng")) bestLang = "kor+eng"; // Fallback an toàn cho T.Hàn

    logger.info(`[DOCUMENT-OCR] Chốt Document Model: ${bestLang} (Điểm: ${bestScore.toFixed(2)}, Tự tin: ${bestConf.toFixed(2)}, Blocks: ${bestBlocks.length})`);
    return { text: bestText, language: bestLang, confidence: bestConf, blocks: bestBlocks };
};