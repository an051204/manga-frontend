import type { TypesettingMetadata } from "../types/translate-image";

/**
 * Xác định typesetting metadata dựa trên ngôn ngữ nguồn đã chọn thủ công.
 *
 * - Manga (Nhật) & Manhua cổ điển (Phồn thể): chữ dọc (vertical-rl)
 * - Comic phương Tây (Anh): chữ ngang (horizontal-tb), căn giữa
 * - Webtoon (Hàn) & Manhua hiện đại (Giản thể): chữ ngang, ngắt dòng hẹp, căn giữa tuyệt đối
 */
export const resolveTypesettingMetadata = (
  sourceLanguage: string,
): TypesettingMetadata => {
  const lang = sourceLanguage.trim().toLowerCase();
  switch (lang) {
    case "jpn":
    case "japanese":
    case "jpn_vert":
      return {
        direction: "vertical-rl",
        alignment: "center-vertical",
        comic_format: "manga",
      };
    case "chi_tra":
    case "chinese traditional":
    case "traditional_chinese":
    case "zht":
    case "cht":
    case "chi_tra_vert":
      return {
        direction: "vertical-rl",
        alignment: "top-right",
        comic_format: "manhua_classic",
      };
    case "eng":
    case "english":
    case "eng+vie":
      return {
        direction: "horizontal-tb",
        alignment: "center",
        comic_format: "comic_western",
      };
    case "kor":
    case "korean":
    case "kor_vert":
      return {
        direction: "horizontal-tb",
        alignment: "absolute-center",
        word_wrap: "narrow",
        comic_format: "webtoon",
      };
    case "chi_sim":
    case "chinese simplified":
    case "zhs":
    case "chi_sim_vert":
      return {
        direction: "horizontal-tb",
        alignment: "absolute-center",
        word_wrap: "narrow",
        comic_format: "manhua_modern",
      };
    default:
      return {
        direction: "horizontal-tb",
        alignment: "center",
        comic_format: "comic_western",
      };
  }
};

/**
 * Lấy nhãn ngôn ngữ dễ đọc để truyền vào Gemini prompt.
 */
export const getSourceLanguageLabel = (lang: string): string => {
  const labels: Record<string, string> = {
    jpn: "Tiếng Nhật (Manga)",
    chi_sim: "Tiếng Trung Giản thể (Manhua hiện đại)",
    chi_tra: "Tiếng Trung Phồn thể (Manhua cổ điển)",
    kor: "Tiếng Hàn (Manhwa/Webtoon)",
    eng: "Tiếng Anh (Comic)",
    "eng+vie": "Tiếng Anh (Comic)",
  };
  return labels[lang.trim().toLowerCase()] || lang;
};

/**
 * Prompt cho chế độ bubble: gửi từng bong bóng đánh số để Gemini dịch riêng lẻ.
 * Mỗi bong bóng có marker [BUBBLE_N] để Gemini trả về per-bubble translation.
 */
export const buildBubbleUserPrompt = (
  bubbleResults: Array<{ text: string }>,
): string => {
  const numbered = bubbleResults
    .map((r, i) => `[BUBBLE_${i}] ${r.text}`)
    .join("\n");
  return `
Dưới đây là văn bản OCR raw từ ${bubbleResults.length} bong bóng thoại trong truyện tranh.
Mỗi bong bóng được đánh dấu [BUBBLE_N]:

${numbered}

Hãy sửa lỗi OCR và dịch từng bong bóng.
Trong trường "original_ocr_text", ghép tất cả text gốc lại.
Trong trường "reconstructed_text", ghép tất cả text đã sửa lỗi lại.
Trong trường "translated_text", trả về bản dịch từng bong bóng THEO ĐÚNG FORMAT:
[BUBBLE_0] bản dịch bong bóng 0
[BUBBLE_1] bản dịch bong bóng 1
...và tiếp tục cho đến hết.
`.trim();
};

/**
 * Parse bản dịch từng bubble từ translated_text có đánh dấu [BUBBLE_N].
 * Sử dụng Regex để tìm tất cả các vị trí marker tuần tự, tránh lỗi khi LLM nhảy cóc marker.
 */
export const parseBubbleTranslations = (
  translatedText: string,
  count: number,
): string[] => {
  const results: string[] = new Array(count).fill("");

  const markerRegex = /\[BUBBLE_(\d+)\]/gi;
  const matches: { markerIndex: number; endPos: number; startPos: number }[] = [];

  let match: RegExpExecArray | null;
  while ((match = markerRegex.exec(translatedText)) !== null) {
    matches.push({
      markerIndex: parseInt(match[1], 10),
      startPos: match.index,
      endPos: match.index + match[0].length,
    });
  }

  if (matches.length > 0) {
    for (let i = 0; i < matches.length; i++) {
      const current = matches[i];
      const nextStart = i + 1 < matches.length ? matches[i + 1].startPos : translatedText.length;
      const text = translatedText.substring(current.endPos, nextStart).trim();

      if (current.markerIndex >= 0 && current.markerIndex < count) {
        results[current.markerIndex] = text;
      }
    }
  }

  // Fallback: nếu không parse được marker nào, dùng full text cho tất cả bubbles
  if (results.every((r) => r === "")) {
    return new Array(count).fill(translatedText.trim());
  }

  return results;
};
