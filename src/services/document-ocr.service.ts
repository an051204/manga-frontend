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
 * Trích xuất text từ lines bên trong 1 paragraph hoặc block khi `.text` ở cấp trên bị trống.
 * Tesseract đôi khi nhóm tiêu đề/heading thành lines nhưng không gán `.text` ở paragraph.
 */
const collectTextFromLines = (node: any, isCjk: boolean): string => {
    if (!node || !node.lines || !Array.isArray(node.lines)) return "";
    const parts: string[] = [];
    for (const line of node.lines) {
        let lineText = (line.text || "").trim();
        if (isCjk) lineText = cleanCjkOcrText(lineText);
        lineText = lineText.replace(/[ \t]+/g, " ").trim();
        if (lineText) parts.push(lineText);
    }
    return parts.join(" ").trim();
};

/**
 * Tính bounding box bao trùm toàn bộ lines bên trong 1 node (paragraph/block).
 */
const computeBboxFromLines = (node: any): { x0: number; y0: number; x1: number; y1: number } | null => {
    if (!node || !node.lines || !Array.isArray(node.lines) || node.lines.length === 0) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const line of node.lines) {
        if (!line.bbox) continue;
        x0 = Math.min(x0, line.bbox.x0 || 0);
        y0 = Math.min(y0, line.bbox.y0 || 0);
        x1 = Math.max(x1, line.bbox.x1 || 0);
        y1 = Math.max(y1, line.bbox.y1 || 0);
    }
    return x0 < Infinity ? { x0, y0, x1, y1 } : null;
};

/**
 * Trích xuất danh sách các khối văn bản/đoạn văn kèm bounding box từ Tesseract result.
 * ✅ Cải tiến: Khai thác cả cấp lines khi paragraph.text bị trống để không sót tiêu đề/heading.
 * ✅ Hỗ trợ quy đổi tọa độ ngược lại theo tỷ lệ `scale` khi ảnh được upscale trước đó.
 */
const extractBlocksFromResult = (
    data: any,
    lang: string,
    scale: number = 1,
): DocumentBlock[] => {
    if (!data || !data.blocks || !Array.isArray(data.blocks)) {
        return [];
    }

    const blocks: DocumentBlock[] = [];
    const isCjk = lang.includes("jpn") || lang.includes("chi");

    /**
     * Thêm 1 khối vào danh sách nếu đạt tiêu chí tối thiểu (kích thước, có ký tự thực).
     */
    const tryPushBlock = (text: string, bbox: any, fallbackConfidence: number): boolean => {
        if (!bbox) return false;

        const rawXmin = bbox.x0 ?? bbox.xmin ?? 0;
        const rawYmin = bbox.y0 ?? bbox.ymin ?? 0;
        const rawXmax = bbox.x1 ?? bbox.xmax ?? (rawXmin + 1);
        const rawYmax = bbox.y1 ?? bbox.ymax ?? (rawYmin + 1);

        const xmin = Math.round(Math.max(0, rawXmin) / scale);
        const ymin = Math.round(Math.max(0, rawYmin) / scale);
        const xmax = Math.round(Math.max(rawXmin + 1, rawXmax) / scale);
        const ymax = Math.round(Math.max(rawYmin + 1, rawYmax) / scale);

        const width = xmax - xmin;
        const height = ymax - ymin;

        const hasLetters = /[\p{L}\p{N}]/u.test(text);
        if (width >= 8 && height >= 8 && text.length > 0 && hasLetters) {
            blocks.push({
                bbox: {
                    xmin,
                    ymin,
                    xmax,
                    ymax,
                },
                text,
                confidence: fallbackConfidence,
            });
            return true;
        }
        return false;
    };

    for (const block of data.blocks) {
        if (!block || !block.bbox) continue;
        const blockConf = (block.confidence || data.confidence || 0) / 100;

        // Nếu block có paragraphs con, ưu tiên lấy theo từng paragraph để chia khối chính xác
        const paragraphs = block.paragraphs && Array.isArray(block.paragraphs) && block.paragraphs.length > 0
            ? block.paragraphs
            : null;

        if (paragraphs) {
            for (const p of paragraphs) {
                if (!p || !p.bbox) continue;

                let text = (p.text || "").trim();
                if (isCjk) text = cleanCjkOcrText(text);
                text = text.replace(/[ \t]+/g, " ").trim();

                const conf = (p.confidence || block.confidence || data.confidence || 0) / 100;

                // ✅ Nếu paragraph.text trống nhưng có lines bên trong → thu thập text từ lines
                if (!text) {
                    text = collectTextFromLines(p, isCjk);
                }

                // ✅ Nếu text vẫn trống → bỏ qua paragraph này
                if (!text) continue;

                // ✅ Nếu paragraph.bbox thiếu kích thước hợp lệ → tính bbox từ lines
                let useBbox = p.bbox;
                const pWidth = (useBbox.x1 || 0) - (useBbox.x0 || 0);
                const pHeight = (useBbox.y1 || 0) - (useBbox.y0 || 0);
                if (pWidth < 8 || pHeight < 8) {
                    const linesBbox = computeBboxFromLines(p);
                    if (linesBbox) useBbox = linesBbox;
                }

                tryPushBlock(text, useBbox, conf);
            }
        } else {
            // Block không có paragraphs → thử trích xuất trực tiếp từ block
            let text = (block.text || "").trim();
            if (isCjk) text = cleanCjkOcrText(text);
            text = text.replace(/[ \t]+/g, " ").trim();

            // ✅ Nếu block.text trống → khai thác lines bên trong block
            if (!text) {
                text = collectTextFromLines(block, isCjk);
            }

            if (text) {
                tryPushBlock(text, block.bbox, blockConf);
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

    const meta = await sharp(imageBuffer).metadata();
    const origW = meta.width || 1;
    const origH = meta.height || 1;

    // Tesseract cần ký tự cao ít nhất ~30px để nhận diện chính xác các nét phức tạp (Hàn, Nhật, Trung, v.v.).
    // Với ảnh tài liệu có độ phân giải thấp (width < 1400px hoặc height < 900px), upscale lên bằng Lanczos3.
    let scale = 1;
    if (origW < 1400 || origH < 900) {
        scale = Math.min(3, Math.max(2, Math.round(1800 / Math.max(origW, origH))));
    }

    let processedImage: Buffer;
    if (scale > 1) {
        processedImage = await sharp(imageBuffer)
            .resize(Math.round(origW * scale), Math.round(origH * scale), { kernel: sharp.kernel.lanczos3 })
            .grayscale()
            .normalize()
            .toBuffer();
        logger.info(`[DOCUMENT-OCR] Ảnh tài liệu độ phân giải nhỏ (${origW}x${origH}), đã upscale ${scale}x (${Math.round(origW * scale)}x${Math.round(origH * scale)}) để Tesseract nhận diện chuẩn xác.`);
    } else {
        processedImage = await sharp(imageBuffer).grayscale().normalize().toBuffer();
    }

    if (manualLanguage !== "auto" && manualLanguage !== "") {
        let worker: Tesseract.Worker | null = null;
        try {
            worker = await Tesseract.createWorker(manualLanguage, 1, OCR_WORKER_OPTIONS);
            await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.AUTO });
            const result = await (worker as any).recognize(processedImage, {}, { blocks: true });
            let text = result.data.text.trim();
            if (manualLanguage.includes("jpn") || manualLanguage.includes("chi")) text = cleanCjkOcrText(text);
            const blocks = extractBlocksFromResult(result.data, manualLanguage, scale);
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
                bestBlocks = extractBlocksFromResult(result.data, lang, scale);
            }
        } finally { if (worker) await worker.terminate(); }
    }

    if (bestLang === "jpn" || bestLang === "chi_sim") bestText = cleanCjkOcrText(bestText);
    if (bestLang === "kor" && hasOcrLanguageData("kor+eng")) bestLang = "kor+eng"; // Fallback an toàn cho T.Hàn

    logger.info(`[DOCUMENT-OCR] Chốt Document Model: ${bestLang} (Điểm: ${bestScore.toFixed(2)}, Tự tin: ${bestConf.toFixed(2)}, Blocks: ${bestBlocks.length})`);
    return { text: bestText, language: bestLang, confidence: bestConf, blocks: bestBlocks };
};