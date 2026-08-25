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
        Lưới lọc Hình học: Phân biệt Văn bản thuần và Truyện tranh cực kỳ an toàn
        Bỏ tính toán màu nền để không nhận diện nhầm Manga đen trắng.
        """
        if not bubbles:
            return True
            
        img_area = image.shape[0] * image.shape[1]
        
        # Luật 1: Bong bóng khổng lồ (Có bong bóng chiếm > 35% diện tích) 
        # -> Manga KHÔNG BAO GIỜ có bong bóng thoại to bằng nửa trang giấy. 
        # Đây chắc chắn là 1 đoạn văn (Paragraph) bị YOLO nhận diện nhầm.
        if any(b["area"] > img_area * 0.35 for b in bubbles):
            logger.warning("[CV-FILTER] Có 1 bong bóng chiếm >35% diện tích ảnh. -> VĂN BẢN THUẦN!")
            return True
            
        # Luật 2: Đa số bong bóng có hình dáng siêu dẹt (Chiều rộng > 4 lần chiều cao)
        # -> Bong bóng truyện tranh thường có hình oval/tròn/chữ nhật. 
        # Nếu 75% bong bóng đều dài sọc, đó chắc chắn là từng dòng chữ của tài liệu.
        wide_bubbles_count = sum(1 for b in bubbles if b["w"] / max(1, b["h"]) > 4.0)
        if len(bubbles) > 2 and (wide_bubbles_count / len(bubbles)) > 0.75:
            logger.warning("[CV-FILTER] Hơn 75% bong bóng có hình dạng siêu dẹt (dòng chữ). -> VĂN BẢN THUẦN!")
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
            if all(self._iou(candidate, existing) < 0.55 for existing in kept):
                kept.append(candidate)
        return kept

    @staticmethod
    def _iou(left, right):
        left_x2 = left["x"] + left["w"]
        left_y2 = left["y"] + left["h"]
        right_x2 = right["x"] + right["w"]
        right_y2 = right["y"] + right["h"]

        intersection_width = max(0, min(left_x2, right_x2) - max(left["x"], right["x"]))
        intersection_height = max(0, min(left_y2, right_y2) - max(left["y"], right["y"]))
        intersection = intersection_width * intersection_height
        union = left["w"] * left["h"] + right["w"] * right["h"] - intersection
        return intersection / union if union else 0.0