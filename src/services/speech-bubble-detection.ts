import { logger } from "../utils/logger";

export interface BubbleBox {
  x: number;
  y: number;
  w: number;
  h: number;
  area?: number;
}

interface DetectionResponse {
  status: string;
  bubbles: BubbleBox[];
  processing_time_ms: number;
  bubble_count: number;
}

/**
 * Gọi Python CV Service để phát hiện bong bóp thoại trong ảnh.
 *
 * Service này sử dụng OpenCV để tìm contours và filter các hình dạng
 * tương ứng với bong bóp thoại (speech bubbles) trong manga.
 *
 * @param imageBuffer - Buffer của ảnh đầu vào
 * @returns Mảng tọa độ bounding box của các bong bóp tìm được
 * @throws Error nếu Python service không khả dụng hoặc timeout
 */
export const detectSpeechBubbles = async (
  imageBuffer: Buffer,
): Promise<BubbleBox[]> => {
  const startTime = Date.now();

  try {
    // 1. Xác định URL của Python CV Service
    const cvServiceUrl = process.env.CV_SERVICE_URL || "http://localhost:8001";
    const detectionUrl = `${cvServiceUrl}/cv/detect-bubbles`;

    logger.info(`[SPEECH-BUBBLE] Gọi CV Service: ${detectionUrl}`);

    // 2. Tạo FormData chứa file ảnh
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(imageBuffer)], {
      type: "image/png",
    });
    formData.append("file", blob, "image.png");

    // 3. POST request với timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

    try {
      const response = await fetch(detectionUrl, {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // 4. Kiểm tra response status
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `CV Service trả về lỗi ${response.status}: ${errorText}`,
        );
      }

      // 5. Parse JSON response
      const data: DetectionResponse = await response.json();

      if (data.status !== "success" || !Array.isArray(data.bubbles)) {
        throw new Error(
          `Invalid response format từ CV Service: ${JSON.stringify(data)}`,
        );
      }

      const duration = Date.now() - startTime;
      logger.info(
        `[SPEECH-BUBBLE] Phát hiện ${data.bubble_count} bong bóp trong ${duration}ms ` +
          `(CV Service processing: ${data.processing_time_ms}ms)`,
      );

      return data.bubbles;
    } catch (fetchError) {
      clearTimeout(timeoutId);

      if (fetchError instanceof Error) {
        // Kiểm tra timeout
        if (fetchError.name === "AbortError") {
          throw new Error(
            "CV Service timeout sau 30 giây. Có thể Python service chưa khởi động hoặc quá tải.",
          );
        }

        throw new Error(`Lỗi kết nối CV Service: ${fetchError.message}`);
      }

      throw fetchError;
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error(
      `[SPEECH-BUBBLE] Lỗi phát hiện bong bóp sau ${duration}ms: ${errorMessage}`,
    );

    throw error;
  }
};

/**
 * Helper: Xác thực rằng bounding boxes hợp lệ
 */
export const validateBubbles = (bubbles: BubbleBox[]): boolean => {
  if (!Array.isArray(bubbles)) return false;

  return bubbles.every(
    (b) =>
      typeof b.x === "number" &&
      typeof b.y === "number" &&
      typeof b.w === "number" &&
      typeof b.h === "number" &&
      b.x >= 0 &&
      b.y >= 0 &&
      b.w > 0 &&
      b.h > 0,
  );
};
