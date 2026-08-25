import { BubbleBox } from "./speech-bubble-detection";
import { ocrMultipleBubbles } from "./per-bubble-ocr";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../utils/logger";

const OCR_DATA_DIR = join(process.cwd(), "traineddata");

const hasOcrLanguageData = (language: string): boolean => {
    return language.split("+").every((lang) => existsSync(join(OCR_DATA_DIR, `${lang}.traineddata`)));
};

export const calibrateBubbleLanguage = async (
    imageBuffer: Buffer,
    bubbles: BubbleBox[]
): Promise<{ selectedBubbleLanguage: string; effectiveSourceLanguage: string }> => {
    logger.info("[CALIBRATION] Bắt đầu chấm điểm đa ngôn ngữ Manga...");

    const calibrationBubbles = [...bubbles]
        .sort((left, right) => (right.area ?? right.w * right.h) - (left.area ?? left.w * left.h))
        .slice(0, Math.min(2, bubbles.length));

    // Tự động dùng eng+vie để test thay vì chỉ eng
    const engModel = hasOcrLanguageData("eng+vie") ? "eng+vie" : "eng";
    const modelsToTest = [engModel, "kor", "jpn_vert", "chi_sim_vert"].filter(hasOcrLanguageData);

    const scoredCandidates = await Promise.all(
        modelsToTest.map(async (candidate) => {
            try {
                const candidateResults = await ocrMultipleBubbles(imageBuffer, calibrationBubbles, candidate, true);
                const text = candidateResults.map((r) => r.text).join(" ");

                let totalConf = 0;
                let validBubbles = 0;
                for (const r of candidateResults) {
                    if (r.text.trim()) {
                        totalConf += r.confidence ?? 0;
                        validBubbles++;
                    }
                }

                const conf = validBubbles > 0 ? totalConf / validBubbles : 0;
                const latin = (text.match(/[a-zA-Z]/g) ?? []).length;
                const hangul = (text.match(/[\uac00-\ud7af]/g) ?? []).length;
                const kana = (text.match(/[\u3040-\u30ff]/g) ?? []).length;
                const han = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
                const validCount = latin + hangul + kana + han;

                let score = 0;
                if (candidate === engModel) {
                    if (hangul > 0 || kana > 0 || han > 0) score = 0;
                    else score = latin * conf;
                } else if (candidate === "kor") {
                    score = hangul * conf;
                    if (validCount > 0 && hangul / validCount < 0.2) score *= 0.1;
                } else if (candidate.startsWith("jpn")) {
                    score = (kana * 2 + han) * conf;
                    if (kana === 0 && han > 0) score *= 0.1;
                } else if (candidate.includes("chi")) {
                    score = han * conf;
                    if (kana > 0 || hangul > 0) score *= 0.1;
                }

                return { candidate, score };
            } catch {
                return { candidate, score: -1 };
            }
        })
    );

    let bestScore = -1;
    let bestCandidate = engModel;

    for (const res of scoredCandidates) {
        if (res.score > bestScore) {
            bestScore = res.score;
            bestCandidate = res.candidate;
        }
    }

    let selectedBubbleLanguage = bestCandidate;
    let effectiveSourceLanguage = "eng";

    if (bestCandidate === engModel) {
        effectiveSourceLanguage = "eng";
    } else if (bestCandidate === "kor") {
        selectedBubbleLanguage = hasOcrLanguageData("kor+eng") ? "kor+eng" : "kor";
        effectiveSourceLanguage = "kor";
    } else if (bestCandidate.startsWith("jpn")) {
        effectiveSourceLanguage = "jpn";
    } else {
        effectiveSourceLanguage = bestCandidate.includes("tra") ? "chi_tra" : "chi_sim";
    }

    logger.info(`[CALIBRATION] Chiến thắng: ${effectiveSourceLanguage} (Điểm: ${bestScore.toFixed(1)})`);
    return { selectedBubbleLanguage, effectiveSourceLanguage };
};