export interface TranslationHistoryItem {
  id: number;
  image_name: string;
  original_ocr_text: string;
  translated_text: string;
  source_language: string;
  target_language: string;
  confidence_score: string;
  created_at: Date;
}

export interface TranslationHistoryResponse {
  status: "success";
  data: TranslationHistoryItem[];
  total: number;
  currentPage: number;
  totalPages: number;
}
