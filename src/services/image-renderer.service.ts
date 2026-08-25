import sharp from "sharp";
import { logger } from "../utils/logger";
import type { BubbleResult, TypesettingMetadata } from "../types/translate-image";

interface RenderOptions {
  /** Bubble results with bbox and translated text */
  bubbles: BubbleResult[];
  /** Typesetting metadata for direction/alignment */
  typesetting?: TypesettingMetadata;
  /** Đang ở chế độ tài liệu văn bản thuần */
  isDocumentMode?: boolean;
}

/**
 * Tính font-size tự động sao cho text vừa vặn trong bounding box.
 * Trả về { fontSize, lines } (text đã wrap).
 */
const calculateFontLayout = (
  text: string,
  boxWidth: number,
  boxHeight: number,
  isVertical: boolean,
  isDocument: boolean = false,
): { fontSize: number; lines: string[] } => {
  // Padding bên trong bubble/block (% kích thước box)
  const padXRatio = isDocument ? 0.03 : 0.08;
  const padYRatio = isDocument ? 0.03 : 0.08;
  const padX = Math.max(3, boxWidth * padXRatio);
  const padY = Math.max(3, boxHeight * padYRatio);
  const availW = boxWidth - padX * 2;
  const availH = boxHeight - padY * 2;

  if (availW <= 0 || availH <= 0) {
    return { fontSize: 10, lines: [text] };
  }

  const cleanText = text.trim();
  if (!cleanText) return { fontSize: 10, lines: [""] };

  // Ước lượng: mỗi ký tự chiếm khoảng 0.55 * fontSize cho horizontal,
  // 1.0 * fontSize cho vertical (CJK full-width)
  const charWidthRatio = isVertical ? 1.0 : 0.55;

  // Thử từ font size lớn nhất có thể, giảm dần
  let bestFontSize = 8;
  let bestLines: string[] = [cleanText];

  const maxFontSize = isDocument
    ? Math.min(Math.max(12, Math.floor(boxHeight * 0.9)), 36)
    : Math.min(availH, 72);

  for (let fontSize = maxFontSize; fontSize >= 7; fontSize -= 0.5) {
    const charWidth = fontSize * charWidthRatio;
    const lineHeight = fontSize * 1.28;

    if (isVertical) {
      // Vertical: mỗi cột chứa N ký tự, tính số cột cần thiết
      const charsPerCol = Math.max(1, Math.floor(availH / (fontSize * 1.1)));
      const cols = Math.ceil(cleanText.length / charsPerCol);
      const totalWidth = cols * fontSize * 1.3;
      if (totalWidth <= availW) {
        bestFontSize = fontSize;
        bestLines = [];
        for (let i = 0; i < cleanText.length; i += charsPerCol) {
          bestLines.push(cleanText.slice(i, i + charsPerCol));
        }
        break;
      }
    } else {
      // Horizontal: wrap text thành nhiều dòng
      const charsPerLine = Math.max(1, Math.floor(availW / charWidth));
      const lines = wrapText(cleanText, charsPerLine);
      const totalHeight = lines.length * lineHeight;
      if (totalHeight <= availH) {
        bestFontSize = fontSize;
        bestLines = lines;
        break;
      }
    }
  }

  return { fontSize: bestFontSize, lines: bestLines };
};

/**
 * Wrap text thành nhiều dòng theo giới hạn ký tự mỗi dòng.
 * Ưu tiên ngắt ở khoảng trắng và tôn trọng các dấu xuống dòng gốc.
 */
const wrapText = (text: string, charsPerLine: number): string[] => {
  if (text.length <= charsPerLine && !text.includes("\n")) return [text];

  const rawParagraphs = text.split(/\r?\n/);
  const allLines: string[] = [];

  for (const rawParagraph of rawParagraphs) {
    const p = rawParagraph.trim();
    if (!p) {
      continue;
    }

    if (p.length <= charsPerLine) {
      allLines.push(p);
      continue;
    }

    const words = p.split(/\s+/);
    let currentLine = "";

    for (const word of words) {
      if (!currentLine) {
        currentLine = word;
      } else if ((currentLine + " " + word).length <= charsPerLine) {
        currentLine += " " + word;
      } else {
        allLines.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine) allLines.push(currentLine);
  }

  // Nếu 1 từ quá dài không có khoảng trắng, cắt cứng
  const result: string[] = [];
  for (const line of allLines) {
    if (line.length <= charsPerLine) {
      result.push(line);
    } else {
      for (let i = 0; i < line.length; i += charsPerLine) {
        result.push(line.slice(i, i + charsPerLine));
      }
    }
  }

  return result.length > 0 ? result : [text];
};

/**
 * Escape ký tự đặc biệt cho SVG XML.
 */
const escapeSvgText = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

/**
 * Tạo SVG overlay cho 1 bubble hoặc 1 block văn bản tài liệu: nền che text gốc + text dịch.
 */
const createBubbleSvg = (
  bubble: BubbleResult,
  isVertical: boolean,
  isDocument: boolean = false,
): Buffer => {
  const bboxW = Math.max(1, bubble.bbox.xmax - bubble.bbox.xmin);
  const bboxH = Math.max(1, bubble.bbox.ymax - bubble.bbox.ymin);
  const translatedText = bubble.translated_text || "";

  if (!translatedText.trim()) {
    // Nếu không có text dịch, fill trắng để xóa text gốc
    const svg = `<svg width="${bboxW}" height="${bboxH}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#ffffff"/>
    </svg>`;
    return Buffer.from(svg);
  }

  const { fontSize, lines } = calculateFontLayout(
    translatedText,
    bboxW,
    bboxH,
    isVertical,
    isDocument,
  );

  const lineHeight = fontSize * 1.28;

  if (isVertical) {
    // Vertical text: mỗi "dòng" là 1 cột, từ phải sang trái
    const colWidth = fontSize * 1.3;
    const totalWidth = lines.length * colWidth;
    const startX = bboxW - (bboxW - totalWidth) / 2 - colWidth / 2;

    const textElements = lines
      .map((col, colIdx) => {
        const x = startX - colIdx * colWidth;
        return Array.from(col)
          .map((char, charIdx) => {
            const y = (bboxH - col.length * fontSize * 1.1) / 2 + charIdx * fontSize * 1.1 + fontSize;
            return `<text x="${x}" y="${y}" font-family="Arial, 'Noto Sans CJK JP', 'Yu Gothic', sans-serif" font-size="${fontSize}" fill="#0f172a" text-anchor="middle">${escapeSvgText(char)}</text>`;
          })
          .join("\n");
      })
      .join("\n");

    const svg = `<svg width="${bboxW}" height="${bboxH}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#ffffff" rx="3"/>
      ${textElements}
    </svg>`;
    return Buffer.from(svg);
  }

  // Horizontal text
  const totalTextHeight = lines.length * lineHeight;
  const startY = Math.max(fontSize, (bboxH - totalTextHeight) / 2 + fontSize * 0.9);

  if (isDocument) {
    // Căn lề trái cho văn bản tài liệu thuần
    const padLeft = Math.max(3, Math.min(8, bboxW * 0.04));
    const textElements = lines
      .map(
        (line, idx) =>
          `<text x="${padLeft}" y="${startY + idx * lineHeight}" font-family="Arial, 'Segoe UI', 'Roboto', sans-serif" font-size="${fontSize}" font-weight="500" fill="#0f172a" text-anchor="start" dominant-baseline="auto">${escapeSvgText(line)}</text>`,
      )
      .join("\n");

    const svg = `<svg width="${bboxW}" height="${bboxH}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#ffffff" rx="2"/>
      ${textElements}
    </svg>`;
    return Buffer.from(svg);
  }

  // Căn lề giữa cho bong bóng truyện tranh
  const centerX = bboxW / 2;
  const textElements = lines
    .map(
      (line, idx) =>
        `<text x="${centerX}" y="${startY + idx * lineHeight}" font-family="Arial, 'Segoe UI', 'Roboto', sans-serif" font-size="${fontSize}" font-weight="500" fill="#0f172a" text-anchor="middle" dominant-baseline="auto">${escapeSvgText(line)}</text>`,
    )
    .join("\n");

  const svg = `<svg width="${bboxW}" height="${bboxH}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#ffffff" rx="4"/>
    ${textElements}
  </svg>`;

  return Buffer.from(svg);
};

/**
 * Render ảnh đã dịch: xóa text gốc trong mỗi bubble/block và thay bằng text dịch trực tiếp trên ảnh gốc.
 *
 * @param imageBuffer - Buffer ảnh gốc
 * @param options - Bubble/block results + typesetting metadata + isDocumentMode
 * @returns Buffer ảnh đã render (PNG)
 */
export const renderTranslatedImage = async (
  imageBuffer: Buffer,
  options: RenderOptions,
): Promise<Buffer> => {
  const { bubbles, typesetting, isDocumentMode } = options;

  if (!bubbles || bubbles.length === 0) {
    logger.warn("[IMAGE-RENDERER] Không có bubbles/blocks để render.");
    return imageBuffer;
  }

  const isVertical = typesetting?.direction === "vertical-rl";
  const isDoc = Boolean(isDocumentMode || typesetting?.comic_format === "document");

  try {
    // Tạo danh sách composite overlays
    const composites: sharp.OverlayOptions[] = bubbles
      .filter((b) => b.translated_text && b.translated_text.trim())
      .map((bubble) => {
        const svgBuffer = createBubbleSvg(bubble, isVertical, isDoc);
        return {
          input: svgBuffer,
          left: bubble.bbox.xmin,
          top: bubble.bbox.ymin,
        };
      });

    if (composites.length === 0) {
      logger.info("[IMAGE-RENDERER] Không có block nào có text dịch.");
      return imageBuffer;
    }

    // Composite tất cả SVG overlays lên ảnh gốc
    const renderedBuffer = await sharp(imageBuffer)
      .composite(composites)
      .png({ quality: 95 })
      .toBuffer();

    logger.info(
      `[IMAGE-RENDERER] Đã render ${composites.length} ${isDoc ? "document blocks" : "bubbles"} lên ảnh (${renderedBuffer.length} bytes).`,
    );

    return renderedBuffer;
  } catch (error) {
    logger.error(
      `[IMAGE-RENDERER] Lỗi render ảnh: ${error instanceof Error ? error.message : String(error)}`,
    );
    return imageBuffer;
  }
};

/**
 * Render ảnh đã dịch cho chế độ tài liệu thuần / toàn trang (khi không phát hiện từng khối riêng lẻ).
 * Tạo một trang tài liệu chuyên nghiệp, căn chỉnh co giãn linh hoạt để không bị cắt bớt bất kỳ từ ngữ nào.
 */
export const renderTranslatedDocumentImage = async (
  imageBuffer: Buffer,
  translatedText: string,
): Promise<Buffer> => {
  try {
    const metadata = await sharp(imageBuffer).metadata();
    const width = Math.max(600, metadata.width || 800);
    const origHeight = Math.max(600, metadata.height || 1000);

    const pad = Math.round(width * 0.05);
    const contentWidth = width - pad * 2;

    // Phân tách các đoạn văn
    const paragraphs = translatedText
      .split(/\r?\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    // Tính toán font size tối ưu để vừa vặn toàn bộ trang
    let chosenFontSize = 16;
    let chosenLineHeight = 24;
    let chosenLinesByParagraph: string[][] = [];
    let totalNeededHeight = 0;

    // Tìm font size từ 24 giảm dần xuống 10 sao cho vừa với chiều cao
    for (let fs = 22; fs >= 10; fs -= 1) {
      const lh = Math.round(fs * 1.5);
      const charsPerLine = Math.max(15, Math.floor(contentWidth / (fs * 0.55)));

      const linesByP: string[][] = [];
      let totalLinesCount = 0;

      for (const p of paragraphs) {
        const wrapped = wrapText(p, charsPerLine);
        linesByP.push(wrapped);
        totalLinesCount += wrapped.length;
      }

      // Chiều cao bao gồm padding top/bottom, header, và khoảng cách giữa các đoạn
      const neededH = pad * 2 + 50 + totalLinesCount * lh + (paragraphs.length - 1) * (fs * 0.7);

      if (neededH <= origHeight || fs === 10) {
        chosenFontSize = fs;
        chosenLineHeight = lh;
        chosenLinesByParagraph = linesByP;
        totalNeededHeight = neededH;
        break;
      }
    }

    const finalHeight = Math.max(origHeight, Math.round(totalNeededHeight + pad));

    // Vẽ các đoạn văn bản
    let currentY = pad + 40;
    const textSvgElements: string[] = [];

    // Tiêu đề nhỏ đầu trang
    textSvgElements.push(
      `<text x="${pad}" y="${pad + 16}" font-family="Arial, 'Segoe UI', 'Roboto', sans-serif" font-size="12" font-weight="bold" fill="#64748b" letter-spacing="1">BẢN DỊCH VĂN BẢN / TRANSLATED DOCUMENT</text>`,
      `<line x1="${pad}" y1="${pad + 26}" x2="${width - pad}" y2="${pad + 26}" stroke="#cbd5e1" stroke-width="1"/>`,
    );

    for (let pIdx = 0; pIdx < chosenLinesByParagraph.length; pIdx++) {
      const lines = chosenLinesByParagraph[pIdx];
      for (const line of lines) {
        textSvgElements.push(
          `<text x="${pad}" y="${currentY}" font-family="Arial, 'Segoe UI', 'Roboto', sans-serif" font-size="${chosenFontSize}" font-weight="400" fill="#1e293b">${escapeSvgText(line)}</text>`,
        );
        currentY += chosenLineHeight;
      }
      currentY += Math.round(chosenFontSize * 0.6); // Khoảng cách giữa các đoạn
    }

    const svg = `<svg width="${width}" height="${finalHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#ffffff"/>
      <rect x="${Math.round(pad * 0.4)}" y="${Math.round(pad * 0.4)}" width="${width - pad * 0.8}" height="${finalHeight - pad * 0.8}" fill="#f8fafc" rx="8" stroke="#e2e8f0" stroke-width="1.5"/>
      ${textSvgElements.join("\n")}
    </svg>`;

    const rendered = await sharp(Buffer.from(svg))
      .png({ quality: 95 })
      .toBuffer();

    return rendered;
  } catch (error) {
    logger.error(`[IMAGE-RENDERER-DOC] Lỗi render văn bản tài liệu: ${error}`);
    return imageBuffer;
  }
};

