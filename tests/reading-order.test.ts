import assert from "node:assert/strict";
import test from "node:test";
import { sortBubbleResults } from "../src/utils/reading-order";

const bubble = (id: string, x: number, y: number) => ({
  id,
  bbox: { x, y, w: 80, h: 80 },
});

test("sorts manga columns right-to-left and top-to-bottom", () => {
  const result = sortBubbleResults(
    [
      bubble("left-top", 100, 10),
      bubble("right-top", 300, 10),
      bubble("right-bottom", 300, 120),
    ],
    "manga",
  );

  assert.deepEqual(
    result.map((item) => item.id),
    ["right-top", "right-bottom", "left-top"],
  );
});

test("sorts modern manhua rows left-to-right and top-to-bottom", () => {
  const result = sortBubbleResults(
    [
      bubble("right-top", 300, 10),
      bubble("left-top", 100, 10),
      bubble("left-bottom", 100, 120),
    ],
    "manhua_modern",
  );

  assert.deepEqual(
    result.map((item) => item.id),
    ["left-top", "right-top", "left-bottom"],
  );
});

test("treats traditional manhua as right-to-left", () => {
  const result = sortBubbleResults(
    [bubble("left", 100, 10), bubble("right", 300, 10)],
    "manhua_classic",
  );

  assert.deepEqual(
    result.map((item) => item.id),
    ["right", "left"],
  );
});
