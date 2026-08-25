import assert from "node:assert/strict";
import test from "node:test";
import { translate } from "google-translate-api-x";

test("google-translate-api-x translates single text correctly", async () => {
  const result = await translate("Hello world", { to: "vi" });
  assert.ok(result.text.length > 0);
  assert.match(result.text.toLowerCase(), /(chào|thế giới)/);
});

test("google-translate-api-x translates array of bubble texts in batch", async () => {
  const inputs = [
    "What are you doing?",
    "I am reading a comic book.",
    "Let's go together!",
  ];

  const results = await translate(inputs, { to: "vi" });
  assert.equal(results.length, 3);
  results.forEach((r: any) => {
    assert.ok(r.text && r.text.length > 0);
  });
});
