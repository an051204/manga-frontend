# Computer Vision Microservice

Microservice phát hiện bong bóp thoại trong manga sử dụng OpenCV.

## Mô tả

Service này sử dụng OpenCV để:

1. Đọc ảnh từ request
2. Áp dụng edge detection và morphological operations
3. Tìm contours và lọc theo aspect ratio
4. Trả về danh sách bounding boxes của các bong bóp thoại

## Setup Local

### 1. Prerequisites

- Python 3.11+
- pip

### 2. Installation

```bash
cd cv-service
pip install -r requirements.txt
```

### 3. Run

```bash
python main.py
```

API sẽ chạy tại `http://localhost:8001`

## API Endpoints

### POST /cv/detect-bubbles

Phát hiện bong bóp thoại từ ảnh.

**Request:**

```bash
curl -X POST "http://localhost:8001/cv/detect-bubbles" \
  -F "file=@manga.jpg"
```

**Response (Success):**

```json
{
  "status": "success",
  "bubbles": [
    { "x": 10, "y": 20, "w": 100, "h": 50, "area": 5000 },
    { "x": 150, "y": 25, "w": 80, "h": 45, "area": 3600 },
    { "x": 50, "y": 150, "w": 120, "h": 60, "area": 7200 }
  ],
  "processing_time_ms": 123.45,
  "bubble_count": 3
}
```

**Response (Error):**

```json
{
  "detail": "Invalid file type. Allowed: {'image/jpeg', 'image/png', 'image/webp'}"
}
```

### GET /health

Health check endpoint.

**Response:**

```json
{
  "status": "ok",
  "service": "cv-service"
}
```

## Docker

### Build Image

```bash
docker build -t cv-service:1.0 .
```

### Run Container

```bash
docker run -p 8001:8001 cv-service:1.0
```

### Docker Compose

```yaml
services:
  cv-service:
    build: ./cv-service
    ports:
      - "8001:8001"
    networks:
      - app-network
```

## Configuration

### SpeechBubbleDetector Parameters

File: `bubble_detector.py`, class `SpeechBubbleDetector`

```python
detector = SpeechBubbleDetector(
    min_area=200,      # Diện tích tối thiểu bubble (pixels)
    max_area=500000    # Diện tích tối đa bubble (pixels)
)
```

### Tuning Guide

- **min_area**: Bubble nhỏ hơn giá trị này sẽ bị bỏ qua
  - Giảm nếu: Sót các bubble nhỏ
  - Tăng nếu: Nhận nhiều noise/shapes nhỏ

- **max_area**: Bubble lớn hơn giá trị này sẽ bị bỏ qua
  - Tăng nếu: Sót các bubble lớn
  - Giảm nếu: Nhận toàn bộ panel làm bubble

- **aspect_ratio** (trong detect_bubbles): Tỷ lệ width/height
  - Hiện tại: 0.3 - 3.5 (tránh các shape quá dẹt)
  - Tăng nếu: Nhận các bubble ngang/dọc mạnh
  - Giảm nếu: Bubble không được nhận vì quá dẹt

### Threshold Value

File: `bubble_detector.py`, line trong `detect_bubbles()`:

```python
_, binary = cv2.threshold(morph, 150, 255, cv2.THRESH_BINARY)
```

- 150: Ngưỡng phân biệt foreground/background
  - Giảm (e.g., 100): Nhạy hơn, lấy thêm nhiều pixels
  - Tăng (e.g., 200): Chọn lọc hơn, lấy ít pixels hơn

## Testing

### Local Test

```bash
# Test dengan curl
curl -X POST "http://localhost:8001/cv/detect-bubbles" \
  -F "file=@test_manga.jpg"

# Test health
curl http://localhost:8001/health
```

### Integration Test

Từ Node.js API, set env variable:

```bash
CV_SERVICE_URL=http://localhost:8001
```

Sau đó upload ảnh với `ocrEngineMode=11` trên giao diện.

## Logs

### Local Run

```
[2024-01-15 10:30:45,123] [CV-SERVICE] INFO - Received image: manga.jpg (524288 bytes)
[2024-01-15 10:30:45,234] [CV-SERVICE] INFO - Starting bubble detection...
[2024-01-15 10:30:45,456] [CV-SERVICE] INFO - Detected 5 bubbles in 123.45ms
```

### Docker Run

```bash
docker logs <container_id> -f
```

## Architecture

```
FastAPI (Uvicorn)
│
├── POST /cv/detect-bubbles
│   ├── Validate file type
│   ├── Read image bytes
│   └── SpeechBubbleDetector.detect_bubbles()
│       ├── cv2.imdecode() - Decode image
│       ├── cv2.bitwise_not() - Invert
│       ├── cv2.morphologyEx() - Clean
│       ├── cv2.threshold() - Binarize
│       ├── cv2.findContours() - Find shapes
│       └── Filter + Sort → Return bubbles
│
└── GET /health
    └── Return status
```

## Troubleshooting

### Module not found: cv2

```bash
pip install opencv-python
```

### Module not found: fastapi / uvicorn

```bash
pip install -r requirements.txt
```

### Port 8001 already in use

```bash
# Find process using port 8001
lsof -i :8001

# Kill process (if needed)
kill -9 <PID>
```

### No bubbles detected

- Check if image is valid (try different images)
- Adjust min_area/max_area parameters
- Check threshold value (currently 150)

### Detected too many/too few bubbles

- See "Configuration" section above for tuning guide
- Aspect ratio filtering may be too strict

## Performance

- Typical processing time: 50-200ms per image
- Depends on image size, number of bubbles, OpenCV performance
- Scales well with concurrent requests (FastAPI is async)

## API Contract with Node.js

Node.js expect response format:

```typescript
interface DetectionResponse {
  status: "success" | "error";
  bubbles: Array<{
    x: number;
    y: number;
    w: number;
    h: number;
    area?: number;
  }>;
  processing_time_ms: number;
  bubble_count: number;
}
```

## License

Part of APIDichAnh project.
