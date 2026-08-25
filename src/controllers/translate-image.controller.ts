import { NextFunction, Request, Response } from "express";
import { translateImageService } from "../services/translate-image.service";
import { ApiError } from "../utils/api-error";
import { logger } from "../utils/logger";

const OCR_TIMEOUT_MS = 180_000;

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timeoutId);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });

const getTranslationOptions = (req: Request) => {
  const targetLanguage =
    typeof req.body.target_language === "string" &&
      req.body.target_language.trim().length > 0
      ? req.body.target_language.trim()
      : "Vietnamese";

  const sourceLanguage =
    typeof req.body.source_language === "string" &&
      req.body.source_language.trim().length > 0
      ? req.body.source_language.trim()
      : "auto";

  // ✅ Đã làm gọn: Nếu không truyền ocr_engine_mode từ form-data, tự động gán null 
  // để kích hoạt Router thông minh (tự phân loại tài liệu/truyện tranh)
  let ocrEngineMode: number | null = null;
  const rawMode = req.body.ocr_engine_mode ?? req.body.ocrEngineMode;

  if (rawMode !== undefined && rawMode !== null && rawMode !== "") {
    const parsed = Number(rawMode);
    if (Number.isInteger(parsed)) {
      ocrEngineMode = parsed;
    } else {
      throw new ApiError("ocr_engine_mode phai la so nguyen hop le.", 400);
    }
  }

  const comicFormat =
    typeof req.body.comic_format === "string"
      ? req.body.comic_format.trim()
      : typeof req.body.comicFormat === "string"
        ? req.body.comicFormat.trim()
        : undefined;

  const allowedComicFormats = new Set([
    "manga",
    "manhua_classic",
    "manhua_modern",
    "webtoon",
    "comic",
  ]);

  if (comicFormat && !allowedComicFormats.has(comicFormat.toLowerCase())) {
    throw new ApiError(
      "comic_format phai la manga, manhua_classic, manhua_modern, webtoon hoac comic.",
      400,
    );
  }

  return { sourceLanguage, targetLanguage, ocrEngineMode, comicFormat };
};

const translateUploadedFile = async (
  file: Express.Multer.File,
  sourceLanguage: string,
  targetLanguage: string,
  ocrEngineMode: number | null,
  comicFormat?: string,
) =>
  withTimeout(
    translateImageService(
      file.buffer,
      file.originalname,
      sourceLanguage,
      targetLanguage,
      ocrEngineMode,
      comicFormat,
    ),
    OCR_TIMEOUT_MS,
    `Xu ly OCR cho file ${file.originalname} vuot qua thoi gian cho phep (${Math.floor(
      OCR_TIMEOUT_MS / 1000,
    )} giay).`,
  );

export const translateImageController = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.file) {
      throw new ApiError("Vui long gui file anh voi field 'image'.", 400);
    }

    const { sourceLanguage, targetLanguage, ocrEngineMode, comicFormat } =
      getTranslationOptions(req);
    const result = await translateUploadedFile(
      req.file,
      sourceLanguage,
      targetLanguage,
      ocrEngineMode,
      comicFormat,
    );

    res.status(200).json({
      status: "success",
      data: result.data,
    });
  } catch (error) {
    next(error);
  }
};

export const translateImagesController = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const files = Array.isArray(req.files) ? req.files : [];
    if (files.length === 0) {
      throw new ApiError(
        "Vui long gui it nhat mot file voi field 'images'.",
        400,
      );
    }

    const { sourceLanguage, targetLanguage, ocrEngineMode, comicFormat } =
      getTranslationOptions(req);

    const results: Array<{
      file_name: string;
      status: "success" | "error";
      data?: Awaited<ReturnType<typeof translateImageService>>["data"];
      error_code?: string;
      message?: string;
    }> = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const result = await translateUploadedFile(
          file,
          sourceLanguage,
          targetLanguage,
          ocrEngineMode,
          comicFormat,
        );
        results.push({
          file_name: file.originalname,
          status: "success",
          data: result.data,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Loi khong xac dinh.";
        const errorCode = error instanceof ApiError ? error.code : undefined;
        logger.warn(`[BATCH] File ${file.originalname} that bai: ${message}`);
        results.push({
          file_name: file.originalname,
          status: "error",
          ...(errorCode ? { error_code: errorCode } : {}),
          message,
        });
      }

      // Nghỉ nhẹ 600ms giữa các ảnh trong batch để bảo vệ RPM quota
      if (i < files.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
    }

    const successCount = results.filter(
      (result) => result.status === "success",
    ).length;
    const failedCount = results.length - successCount;

    res.status(failedCount === 0 ? 200 : 207).json({
      status: failedCount === 0 ? "success" : "partial_success",
      data: results,
      total: results.length,
      success_count: successCount,
      failed_count: failedCount,
    });
  } catch (error) {
    next(error);
  }
};