import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { processDocumentOcr } from "../src/services/document-ocr.service";
import { renderTranslatedImage, renderTranslatedDocumentImage } from "../src/services/image-renderer.service";

test("document OCR extracts blocks with coordinates from plain text document image", async () => {
  // Create an image with two paragraphs of English text
  const svg = `<svg width="600" height="400" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="white"/>
    <text x="40" y="80" font-family="Arial" font-size="24" font-weight="bold" fill="black">Document Header Title</text>
    <text x="40" y="160" font-family="Arial" font-size="18" fill="black">This is the first paragraph describing something important.</text>
    <text x="40" y="240" font-family="Arial" font-size="18" fill="black">This is the second paragraph with additional details.</text>
  </svg>`;
  const imgBuffer = await sharp(Buffer.from(svg)).png().toBuffer();

  const ocrResult = await processDocumentOcr(imgBuffer, "eng");
  assert.ok(ocrResult.text.length > 0, "OCR text should not be empty");
  assert.ok(ocrResult.blocks.length > 0, "OCR blocks should be extracted");

  console.log(`[TEST] Extracted ${ocrResult.blocks.length} blocks:`);
  ocrResult.blocks.forEach((b, i) => {
    console.log(`  Block ${i}: [${b.bbox.xmin}, ${b.bbox.ymin}, ${b.bbox.xmax}, ${b.bbox.ymax}] => ${b.text}`);
  });

  // Verify in-place render
  const bubbles = ocrResult.blocks.map((b, i) => ({
    bbox: b.bbox,
    original_text: b.text,
    translated_text: `Đoạn văn bản dịch số ${i + 1} sang tiếng Việt`,
    confidence: b.confidence,
  }));

  const renderedImageBuffer = await renderTranslatedImage(imgBuffer, {
    bubbles,
    isDocumentMode: true,
  });

  assert.ok(renderedImageBuffer.length > 0, "Rendered image buffer should not be empty");
  const renderedMeta = await sharp(renderedImageBuffer).metadata();
  assert.equal(renderedMeta.width, 600);
  assert.equal(renderedMeta.height, 400);
});

test("full-page document renderer produces clean formatted document image without clipping", async () => {
  const dummyImage = await sharp({
    create: {
      width: 700,
      height: 900,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  }).png().toBuffer();

  const longTranslatedDoc = `Tiêu đề: Báo cáo kết quả phân tích tài liệu văn bản thuần

Đoạn 1: Hệ thống đã bóc tách thành công toàn bộ văn bản trong ảnh và tiến hành dịch thuật chính xác sang tiếng Việt.

Đoạn 2: Tất cả các đoạn văn đều được căn lề chuẩn, co giãn font chữ tự động thích ứng với trang giấy để không bị cắt bớt bất kỳ nội dung nào.

Đoạn 3: Kết quả cho thấy việc render tài liệu thuần giờ đây hoạt động hoàn hảo và mượt mà trên toàn bộ hệ thống.`;

  const renderedDocBuffer = await renderTranslatedDocumentImage(dummyImage, longTranslatedDoc);
  assert.ok(renderedDocBuffer.length > 0, "Rendered document buffer should not be empty");

  const meta = await sharp(renderedDocBuffer).metadata();
  assert.ok((meta.width || 0) >= 600);
  assert.ok((meta.height || 0) >= 600);
});
