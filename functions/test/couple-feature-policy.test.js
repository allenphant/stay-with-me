"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DAILY_QUESTIONS,
  GUINEA_PIG_FEEDS,
  GUINEA_PIG_POLICY,
  TOKEN_POLICY,
  calculateDiaryPrice,
  normalizeDateKey,
  questionForDate,
} = require("../src/couple-feature-policy");

test("diary pricing is proportional, bounded, and never free", () => {
  assert.equal(calculateDiaryPrice(1), TOKEN_POLICY.diaryMinimumPrice);
  assert.equal(calculateDiaryPrice(20), TOKEN_POLICY.diaryMinimumPrice);
  assert.equal(calculateDiaryPrice(21), 3);
  assert.equal(calculateDiaryPrice(700), TOKEN_POLICY.diaryMaximumPrice);
  assert.equal(calculateDiaryPrice("not a number"), TOKEN_POLICY.diaryMinimumPrice);
});

test("date keys are strict calendar dates", () => {
  assert.equal(normalizeDateKey("2026-09-17"), "2026-09-17");
  assert.equal(normalizeDateKey("2026-02-30"), "");
  assert.equal(normalizeDateKey("2026/09/17"), "");
});

test("daily question selection is deterministic", () => {
  assert.ok(DAILY_QUESTIONS.includes(questionForDate("2026-09-17")));
  assert.equal(questionForDate("2026-09-17"), questionForDate("2026-09-17"));
  assert.equal(questionForDate("invalid"), DAILY_QUESTIONS[0]);
});

test("guinea pig feed policy has bounded, token-priced care options", () => {
  assert.equal(GUINEA_PIG_POLICY.name, "小糰子");
  assert.deepEqual(Object.keys(GUINEA_PIG_FEEDS), ["hay", "vegetables", "treat"]);
  for (const feed of Object.values(GUINEA_PIG_FEEDS)) {
    assert.ok(feed.cost > 0);
    assert.ok(feed.hunger >= 0 && feed.hunger <= 100);
    assert.ok(feed.mood >= 0 && feed.mood <= 100);
  }
});
