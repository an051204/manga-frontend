from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import JSONResponse
import logging
from bubble_detector import SpeechBubbleDetector
import time

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] [CV-SERVICE] %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Computer Vision Microservice",
    description="Phát hiện bong bóp thoại trong Manga",
    version="1.0.0"
)

detector = SpeechBubbleDetector(
    model_path="models/comic-speech-bubble-detector.pt"
)


@app.post("/cv/detect-bubbles")
async def detect_bubbles(file: UploadFile = File(...)):
    """
    Nhận ảnh, phát hiện bong bóp thoại bằng YOLOv8.
    
    Request:
        - file: UploadFile (image/jpeg, image/png, image/webp)
    
    Response:
        {
            "status": "success",
            "bubbles": [
                {"x": 10, "y": 20, "w": 100, "h": 50},
                ...
            ],
            "processing_time_ms": 123,
            "bubble_count": 5
        }
    """
    start_time = time.time()
    
    try:
        # 1. Validate file type
        allowed_types = {"image/jpeg", "image/png", "image/webp"}
        if file.content_type not in allowed_types:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid file type. Allowed: {allowed_types}"
            )
        
        # 2. Read file bytes
        image_bytes = await file.read()
        logger.info(f"Received image: {file.filename} ({len(image_bytes)} bytes)")
        
        # 3. Detect bubbles
        logger.info("Starting bubble detection...")
        bubbles = detector.detect_bubbles(image_bytes)
        
        processing_time = (time.time() - start_time) * 1000  # ms
        logger.info(
            f"Detected {len(bubbles)} bubbles in {processing_time:.2f}ms"
        )
        
        return JSONResponse({
            "status": "success",
            "bubbles": bubbles,
            "processing_time_ms": round(processing_time, 2),
            "bubble_count": len(bubbles)
        })
        
    except HTTPException as e:
        logger.error(f"HTTP Error: {e.detail}")
        raise e
    except Exception as e:
        logger.error(f"Unexpected error: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok", "service": "cv-service"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001, log_level="info")
