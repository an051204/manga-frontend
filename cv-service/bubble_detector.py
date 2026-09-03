import cv2
import numpy as np
import logging
from typing import List, Dict
import os
from ultralytics import YOLO

logger = logging.getLogger(__name__)

class SpeechBubbleDetector:
    def __init__(self, model_path: str = "models/comic-speech-bubble-detector.pt"):
        self.model_path = model_path
        if not os.path.exists(self.model_path):
            raise FileNotFoundError(f"Không tìm thấy file mô hình tại {self.model_path}. Vui lòng tải về và bỏ vào thư mục models!")
        
        logger.info(f"Đang tải mô hình YOLOv8 từ: {self.model_path}")
        self.model = YOLO(self.model_path)
        self.confidence_threshold = float(os.getenv("BUBBLE_CONFIDENCE", "0.25"))
        self.image_size = int(os.getenv("BUBBLE_IMAGE_SIZE", "1280"))
        logger.info("Tải mô hình YOLOv8 thành công!")

    def _is_document_image(self, image: np.ndarray, bubbles: List[Dict[str, int]]) -> bool:
        """
        Lưới lọc Hình học & Cấu trúc Văn bản:
        Phân biệt chính xác giữa Tài liệu văn bản (Ghi chú, Sách, Đề thi) và Truyện tranh.
        """
        if not bubbles:
            return True
            
        h, w = image.shape[:2]
        img_area = h * w
        
        # Luật 1: Bong bóng khổng lồ (chiếm >28% diện tích trang)
        # Truyện tranh hiếm khi có 1 bong bóng chiếm gần 1/3 trang giấy. Đây là cả một đoạn văn.
        if any(b["area"] > img_area * 0.28 for b in bubbles):
            logger.warning("[CV-FILTER] Phát hiện bong bóng chiếm >28% diện tích ảnh -> VĂN BẢN THUẦN!")
            return True
            
        # Luật 2: Đa số bong bóng có hình dáng siêu dẹt (dòng chữ)
        wide_bubbles_count = sum(1 for b in bubbles if b["w"] / max(1, b["h"]) > 4.0)
        if len(bubbles) > 2 and (wide_bubbles_count / len(bubbles)) > 0.70:
            logger.warning("[CV-FILTER] Hơn 70% bong bóng có hình dạng siêu dẹt (dòng chữ) -> VĂN BẢN THUẦN!")
            return True

        # Phân tích cấu trúc dòng chữ bằng hình thái học (Morphology)
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (20, 2))
        connected = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)
        contours, _ = cv2.findContours(connected, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        # Luật 3: Dòng chữ cắt ngang qua mép bong bóng (Text crossing bubble boundary)
        # Trong truyện tranh, chữ LUÔN nằm trọn bên trong bong bóng.
        # Trong tài liệu, khi YOLO nhận nhầm 1 khối ở giữa trang, các dòng chữ của đoạn văn
        # sẽ đâm xuyên qua đường biên trái/phải của "bong bóng".
        for b in bubbles:
            bx1, by1 = b["x"], b["y"]
            bx2, by2 = bx1 + b["w"], by1 + b["h"]
            crossing_count = 0

            for c in contours:
                cx, cy, cw, ch = cv2.boundingRect(c)
                if cw > 40 and 6 < ch < 60 and (cw / max(1, ch)) > 2.0:
                    crosses_left = (cx < bx1 and cx + cw > bx1 + 25 and cy + ch > by1 and cy < by2)
                    crosses_right = (cx < bx2 - 25 and cx + cw > bx2 and cy + ch > by1 and cy < by2)
                    if crosses_left or crosses_right:
                        crossing_count += 1

            if crossing_count >= 2:
                logger.warning(f"[CV-FILTER] Có {crossing_count} dòng chữ cắt ngang biên giới bong bóng -> VĂN BẢN THUẦN!")
                return True

        # Luật 4: Trang tài liệu dày đặc dòng chữ (≥8 dòng chữ trải dài >60% chiều cao trang)
        text_lines = [
            c for c in contours 
            if cv2.boundingRect(c)[2] > 60 and 6 < cv2.boundingRect(c)[3] < 60 and (cv2.boundingRect(c)[2] / max(1, cv2.boundingRect(c)[3])) > 2.5
        ]
        if len(text_lines) >= 8:
            y_min = min(cv2.boundingRect(c)[1] for c in text_lines)
            y_max = max(cv2.boundingRect(c)[1] + cv2.boundingRect(c)[3] for c in text_lines)
            if (y_max - y_min) > h * 0.60:
                logger.warning(f"[CV-FILTER] Trang có {len(text_lines)} dòng văn bản trải dài {(y_max-y_min)/h*100:.1f}% chiều cao trang -> VĂN BẢN THUẦN!")
                return True

        return False

    def detect_bubbles(self, image_buffer: bytes) -> List[Dict[str, int]]:
        nparr = np.frombuffer(image_buffer, np.uint8)
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError("Không thể giải mã ảnh đầu vào")
        
        results = self.model.predict(
            image,
            verbose=False,
            conf=self.confidence_threshold,
            iou=0.45,
            imgsz=self.image_size,
            max_det=100,
        )

        detections = self._collect_detections(results, image.shape)
        
        # Pass cứu hộ
        if not detections:
            rescue_confidence = max(0.10, self.confidence_threshold - 0.10)
            rescue_size = max(self.image_size, 1536)
            logger.info(
                "Không có bubble ở pass đầu, chạy pass cứu hộ "
                f"(conf={rescue_confidence}, imgsz={rescue_size})"
            )
            rescue_results = self.model.predict(
                image,
                verbose=False,
                conf=rescue_confidence,
                iou=0.45,
                imgsz=rescue_size,
                max_det=100,
            )
            detections = self._collect_detections(rescue_results, image.shape)

        bubbles = [
            {
                "x": detection["x"],
                "y": detection["y"],
                "w": detection["w"],
                "h": detection["h"],
                "area": detection["w"] * detection["h"],
            }
            for detection in detections
        ]
        
        # ✅ KÍCH HOẠT LƯỚI LỌC TRƯỚC KHI TRẢ KẾT QUẢ VỀ NODE.JS
        if self._is_document_image(image, bubbles):
            logger.info("[CV-FILTER] Đã hủy toàn bộ Bubble để chuyển nhượng quyền cho Document Mode!")
            return []
        
        logger.info(f"YOLOv8 đã chốt được {len(bubbles)} bong bóng thoại chuẩn!")
        return bubbles

    def _collect_detections(self, results, image_shape):
        image_height, image_width = image_shape[:2]
        candidates = []

        if len(results) == 0 or results[0].boxes is None:
            return candidates

        boxes = results[0].boxes.xyxy.cpu().numpy()
        confidences = results[0].boxes.conf.cpu().numpy()

        for box, confidence in zip(boxes, confidences):
            x1, y1, x2, y2 = [int(value) for value in box]
            x1 = max(0, min(x1, image_width - 1))
            y1 = max(0, min(y1, image_height - 1))
            x2 = max(x1 + 1, min(x2, image_width))
            y2 = max(y1 + 1, min(y2, image_height))
            width, height = x2 - x1, y2 - y1

            if width < 12 or height < 12:
                continue

            candidates.append({
                "x": x1,
                "y": y1,
                "w": width,
                "h": height,
                "confidence": float(confidence),
            })

        candidates.sort(key=lambda item: item["confidence"], reverse=True)
        kept = []
        for candidate in candidates:
            duplicate_idx = -1
            for idx, existing in enumerate(kept):
                if self._is_duplicate(candidate, existing):
                    duplicate_idx = idx
                    break

            if duplicate_idx == -1:
                kept.append(candidate)
            else:
                # Nếu candidate bao trùm lớn hơn hẳn existing (>30% diện tích) -> lấy box lớn hơn đầy đủ
                if candidate["w"] * candidate["h"] > kept[duplicate_idx]["w"] * kept[duplicate_idx]["h"] * 1.3:
                    kept[duplicate_idx] = candidate
        return kept

    @staticmethod
    def _is_duplicate(left, right):
        left_x2 = left["x"] + left["w"]
        left_y2 = left["y"] + left["h"]
        right_x2 = right["x"] + right["w"]
        right_y2 = right["y"] + right["h"]

        intersection_width = max(0, min(left_x2, right_x2) - max(left["x"], right["x"]))
        intersection_height = max(0, min(left_y2, right_y2) - max(left["y"], right["y"]))
        intersection = intersection_width * intersection_height
        if intersection <= 0:
            return False

        area_left = left["w"] * left["h"]
        area_right = right["w"] * right["h"]
        union = area_left + area_right - intersection
        iou = intersection / union if union else 0.0
        iomin = intersection / min(area_left, area_right)

        # Trùng nếu IoU >= 0.40 hoặc box nhỏ nằm lọt >= 60% bên trong box lớn
        return iou >= 0.40 or iomin >= 0.60