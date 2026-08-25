import assert from "node:assert/strict";
import test from "node:test";
import { scoreCjkCandidate } from "../src/services/per-bubble-ocr";

test("Kana gives Japanese a decisive score boost", () => {
  const japaneseScore = scoreCjkCandidate("これは漫画です", 35, "jpn_vert");
  const chineseScore = scoreCjkCandidate("这是漫画", 90, "chi_sim_vert");

  assert.ok(japaneseScore > chineseScore);
});

test("special-character-heavy OCR is rejected", () => {
  const score = scoreCjkCandidate("|\\/[]~^", 95, "chi_sim_vert");

  assert.equal(score, Number.NEGATIVE_INFINITY);
});

test("short Korean hallucination is rejected", () => {
  const score = scoreCjkCandidate("나", 95, "kor+eng");

  assert.equal(score, Number.NEGATIVE_INFINITY);
});
