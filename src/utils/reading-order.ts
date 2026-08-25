import type { BubbleBox } from "../services/speech-bubble-detection";

export type ComicLayout =
  | "manga"
  | "manhua_classic"
  | "manhua_modern"
  | "webtoon"
  | "comic";

export const isRightToLeftLayout = (layout: ComicLayout): boolean =>
  layout === "manga" || layout === "manhua_classic";

const sortByRows = <T extends { bbox: BubbleBox }>(items: T[]): T[] => {
  const sorted: T[] = [];
  const rows: T[][] = [];

  for (const item of items) {
    const centerY = item.bbox.y + item.bbox.h / 2;
    const row = rows.find((candidateRow) => {
      const averageY =
        candidateRow.reduce(
          (total, current) => total + current.bbox.y + current.bbox.h / 2,
          0,
        ) / candidateRow.length;
      const averageHeight =
        candidateRow.reduce((total, current) => total + current.bbox.h, 0) /
        candidateRow.length;
      return Math.abs(centerY - averageY) <= averageHeight * 0.6;
    });

    if (row) row.push(item);
    else rows.push([item]);
  }

  rows
    .sort(
      (left, right) =>
        Math.min(...left.map((item) => item.bbox.y)) -
        Math.min(...right.map((item) => item.bbox.y)),
    )
    .forEach((row) => {
      row.sort(
        (left, right) =>
          left.bbox.x + left.bbox.w / 2 - (right.bbox.x + right.bbox.w / 2),
      );
      sorted.push(...row);
    });

  return sorted;
};

const sortByColumns = <T extends { bbox: BubbleBox }>(items: T[]): T[] => {
  const sorted: T[] = [];
  const columns: T[][] = [];

  for (const item of items) {
    const centerX = item.bbox.x + item.bbox.w / 2;
    const column = columns.find((candidateColumn) => {
      const averageX =
        candidateColumn.reduce(
          (total, current) => total + current.bbox.x + current.bbox.w / 2,
          0,
        ) / candidateColumn.length;
      const averageWidth =
        candidateColumn.reduce((total, current) => total + current.bbox.w, 0) /
        candidateColumn.length;
      return Math.abs(centerX - averageX) <= averageWidth * 0.6;
    });

    if (column) column.push(item);
    else columns.push([item]);
  }

  columns
    .sort(
      (left, right) =>
        Math.max(...right.map((item) => item.bbox.x + item.bbox.w)) -
        Math.max(...left.map((item) => item.bbox.x + item.bbox.w)),
    )
    .forEach((column) => {
      column.sort((left, right) => left.bbox.y - right.bbox.y);
      sorted.push(...column);
    });

  return sorted;
};

export const sortBubbleResults = <T extends { bbox: BubbleBox }>(
  items: T[],
  layout: ComicLayout,
): T[] =>
  isRightToLeftLayout(layout) ? sortByColumns(items) : sortByRows(items);
