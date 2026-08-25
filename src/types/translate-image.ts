export interface TypesettingMetadata {
  /** Hướng chữ: "vertical-rl" (Manga/Manhua cổ) hoặc "horizontal-tb" (Comic/Webtoon/Manhua hiện đại) */
  direction: "vertical-rl" | "horizontal-tb";
  /** Căn lề hiển thị */
  alignment:
    | "center-vertical"
    | "top-right"
    | "center"
    | "top-left"
    | "left"
    | "absolute-center";
  /** Ngắt dòng hẹp cho Webtoon/Manhua hiện đại */
  word_wrap?: "narrow";
  /** Tên định dạng truyện tranh / văn bản nguồn */
  comic_format:
    | "manga"
    | "manhua_classic"
    | "comic_western"
    | "webtoon"
    | "manhua_modern"
    | "document";
}

export interface DocumentBlock {
  bbox: {
    xmin: number;
    ymin: number;
    xmax: number;
    ymax: number;
  };
  text: string;
  confidence: number;
}

export interface BubbleResult {
  /** Tọa độ bounding box từ YOLOv8 hoặc Tesseract Document OCR */
  bbox: {
    xmin: number;
    ymin: number;
    xmax: number;
    ymax: number;
  };
  /** Text gốc OCR trong bubble/block */
  original_text: string;
  /** Text đã dịch */
  translated_text: string;
  /** Độ tin cậy OCR (0.0 - 1.0) */
  confidence?: number;
}

export interface TranslateImageData {
  detected_source_language: string;
  original_ocr_text: string;
  reconstructed_text: string;
  translated_text: string;
  confidence_score: string;
  /** Confidence trung bình của Tesseract trước khi gửi Gemini (0.0 - 1.0). */
  ocr_confidence?: number;
  /** Layout được dùng để sắp xếp bubble. */
  comic_format?: string;
  /** Metadata typesetting dựa trên ngôn ngữ nguồn */
  typesetting_metadata?: TypesettingMetadata;
  /** Danh sách bubble với tọa độ và text đã dịch (chỉ có khi dùng bubble detection mode) */
  bubbles?: BubbleResult[];
  /** Ảnh đã dịch, encoded base64 (PNG). Chỉ có khi dùng bubble detection mode. */
  translated_image_base64?: string;
}

export interface TranslateImageResponse {
  status: "success";
  data: TranslateImageData;
}
