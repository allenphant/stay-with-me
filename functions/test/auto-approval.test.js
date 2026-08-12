"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildAutoApprovalWrites,
  formatResearchNote,
  shouldAutoApproveJob,
} = require("../src/auto-approval");

test("only auto web jobs are written without review", () => {
  assert.equal(shouldAutoApproveJob({approvalMode: "auto", sourceKind: "web"}), true);
  assert.equal(shouldAutoApproveJob({approvalMode: "manual", sourceKind: "web"}), false);
  assert.equal(shouldAutoApproveJob({approvalMode: "auto", sourceKind: "youtube"}), false);
});

test("auto approval appends note, search text, and deterministic tags", () => {
  const writes = buildAutoApprovalWrites({
    card: {
      text: "原始卡片 https://example.com/post",
      tagIds: ["existing"],
      researchSearchText: "舊摘要",
    },
    noteData: {
      time: 1,
      blocks: [{type: "paragraph", data: {text: "既有內容"}}],
    },
    tags: [
      {id: "existing", name: "既有"},
      {id: "software", name: "軟體開發"},
    ],
    result: {
      tldr: "摘要 <安全>",
      verdict: "值得閱讀",
      notes: "第一行\n第二行",
      suggestedTags: ["軟體開發", "新工具", "新工具", "tag-5wcwmz"],
      limitations: "只讀到公開文字",
      sourceUrl: "https://example.com/post",
    },
    now: 1_750_000_000_000,
  });

  assert.equal(writes.noteData.blocks.length, 3);
  assert.equal(writes.noteData.blocks[1].type, "header");
  assert.match(writes.noteData.blocks[2].data.text, /摘要 &lt;安全&gt;/);
  assert.match(writes.noteData.blocks[2].data.text, /第一行<br>第二行/);
  assert.equal(writes.cardData.cardSearchText, "原始卡片 https://example.com/post");
  assert.match(writes.cardData.researchSearchText, /舊摘要/);
  assert.match(writes.cardData.researchSearchText, /tl;dr：摘要 <安全>/);
  assert.deepEqual(writes.cardData.tagIds.slice(0, 2), ["existing", "software"]);
  assert.equal(writes.tags.find((tag) => tag.name === "新工具")?.id.startsWith("tag-"), true);
  assert.equal(writes.cardData.tagIds.includes(
    writes.tags.find((tag) => tag.name === "新工具").id,
  ), true);
  assert.equal(writes.tags.some((tag) => tag.name === "tag-5wcwmz"), false);
});

test("auto approval preserves a legacy note object and safely handles empty results", () => {
  const writes = buildAutoApprovalWrites({
    card: {text: "https://example.com"},
    noteData: {version: "legacy"},
    result: {},
    now: 123,
  });
  assert.equal(writes.noteData.version, "legacy");
  assert.equal(writes.noteData.blocks.length, 2);
  assert.equal(formatResearchNote({}), "雲端研讀沒有回傳可用內容。");
});
