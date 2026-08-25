import { NextFunction, Request, Response, Router } from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import {
  translateImageController,
  translateImagesController,
} from "../controllers/translate-image.controller";
import { uploadImage } from "../middlewares/upload.middleware";

const translateImageRouter = Router();

const translateImageLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  message: {
    status: "error",
    message: "Đang xử lý quá nhiều ảnh. Vui lòng đợi một chút rồi thử lại.",
  },
});

const translateImagesLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  message: {
    status: "error",
    message: "Đang xử lý quá nhiều lô ảnh. Vui lòng đợi một chút rồi thử lại.",
  },
});

translateImageRouter.get("/translate-image", (_req, res) => {
  res.status(405).json({
    status: "error",
    message:
      "Endpoint nay chi ho tro POST multipart/form-data. Hay upload anh qua form hoac Swagger Try it out.",
  });
});

// Endpoint chinh cua do an: POST /api/v1/translate-image
/**
 * @openapi
 * /api/v1/translate-image:
 *   get:
 *     summary: "Thong bao dung sai method"
 *     tags:
 *       - Translation
 *     responses:
 *       405:
 *         description: "Chi ho tro POST multipart/form-data"
 *   post:
 *     summary: "Bóc tách và dịch văn bản từ hình ảnh"
 *     tags:
 *       - Translation
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - image
 *             properties:
 *               image:
 *                 type: string
 *                 format: binary
 *                 description: "File anh (jpg/png/webp) - field name = image"
 *               source_language:
 *                 type: string
 *                 description: "Ngôn ngữ đầu vào: auto, eng+vie, jpn, kor, chi_sim, chi_tra"
 *               ocr_engine_mode:
 *                 type: integer
 *                 description: "Che do OCR thu cong; set 5 (PSM 5) hoac 11 (PSM 11 Sparse Text) cho truyen tranh/comic. Ho tro eng, jpn, chi_sim, chi_tra, kor."
 *               comic_format:
 *                 type: string
 *                 enum: [manga, manhua_classic, manhua_modern, webtoon, comic]
 *                 description: "Layout doc: manga/manhua_classic = RTL; manhua_modern/webtoon/comic = LTR"
 *               target_language:
 *                 type: string
 *                 description: "Ngôn ngữ đích (ví dụ: Vietnamese, English)"
 *     responses:
 *       200:
 *         description: "Kết quả dịch thành công"
 */
translateImageRouter.post(
  "/translate-image",
  translateImageLimiter,
  uploadImage.single("image"),
  (error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (!error) {
      next();
      return;
    }

    if (
      error instanceof multer.MulterError &&
      error.code === "LIMIT_FILE_SIZE"
    ) {
      res.status(400).json({
        status: "error",
        message: "File ảnh vượt quá dung lượng cho phép (tối đa 5MB)!",
      });
      return;
    }

    if (error instanceof Error) {
      res.status(400).json({
        status: "error",
        message: error.message,
      });
      return;
    }

    next(error);
  },
  translateImageController,
);

/**
 * @openapi
 * /api/v1/translate-images:
 *   post:
 *     summary: "Bóc tách và dịch nhiều ảnh tuần tự"
 *     tags:
 *       - Translation
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - images
 *             properties:
 *               images:
 *                 type: array
 *                 maxItems: 10
 *                 items:
 *                   type: string
 *                   format: binary
 *               source_language:
 *                 type: string
 *               target_language:
 *                 type: string
 *               ocr_engine_mode:
 *                 type: integer
 *               comic_format:
 *                 type: string
 *                 enum: [manga, manhua_classic, manhua_modern, webtoon, comic]
 *     responses:
 *       200:
 *         description: "Tất cả ảnh được dịch thành công"
 *       207:
 *         description: "Một phần ảnh bị lỗi"
 */
translateImageRouter.post(
  "/translate-images",
  translateImagesLimiter,
  uploadImage.array("images", 10),
  (error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (!error) {
      next();
      return;
    }

    if (
      error instanceof multer.MulterError &&
      error.code === "LIMIT_FILE_SIZE"
    ) {
      res.status(400).json({
        status: "error",
        message: "File ảnh vượt quá dung lượng cho phép (tối đa 5MB)!",
      });
      return;
    }

    if (error instanceof Error) {
      res.status(400).json({ status: "error", message: error.message });
      return;
    }

    next(error);
  },
  translateImagesController,
);

export default translateImageRouter;
