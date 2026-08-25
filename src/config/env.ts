import dotenv from "dotenv";
import { join } from "node:path";

// Tải biến môi trường từ file .env nếu có.
dotenv.config();

// Set TESSDATA_PREFIX để Tesseract biết tìm traineddata ở đâu
// Điều này prevents Tesseract tự động download hoặc sinh ra file ở root
const trainedDataDir = join(process.cwd(), "traineddata");
process.env.TESSDATA_PREFIX = trainedDataDir;

const port = Number(process.env.PORT ?? 3000);

export const env = {
  port: Number.isNaN(port) ? 3000 : port,
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
  ocrLanguage: process.env.OCR_LANGUAGE ?? "eng",
};

