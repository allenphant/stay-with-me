"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ExternalServiceError,
  RESEARCH_RESULT_SCHEMA,
  buildUnparsedYouTubeResult,
  extractGenerateContentText,
  extractInteractionText,
  extractOpenRouterText,
  isFreeTextModel,
  isSupportedResearchText,
  normalizeResearchResult,
  parseResearchResult,
  selectOpenRouterFreeModels,
  serviceErrorFromResponse,
  stripJsonFence,
} = require("../src/providers");

test("strips fenced JSON without touching normal JSON", () => {
  assert.equal(stripJsonFence("```json\n{\"a\":1}\n```"), "{\"a\":1}");
  assert.equal(stripJsonFence("{\"a\":1}"), "{\"a\":1}");
});

test("normalizes model result and limits tags", () => {
  assert.deepEqual(normalizeResearchResult({
    tldr: " 摘要 ",
    verdict: " 評價 ",
    notes: " 筆記 ",
    suggestedTags: ["A", " B ", "", "C", "D", "E", "F"],
    limitations: " 無 ",
  }, "https://example.com"), {
    tldr: "摘要",
    verdict: "評價",
    notes: "筆記",
    suggestedTags: ["A", "B", "C", "D", "E"],
    limitations: "無",
    sourceUrl: "https://example.com",
  });
});

test("normalizes common model aliases and wrapped results", () => {
  assert.deepEqual(normalizeResearchResult({result: {
    summary: "摘要",
    recommendation: "值得閱讀",
    keyPoints: ["第一點", "第二點"],
    tags: "網路、標準",
    caveats: "僅供示範",
  }}, "https://example.com"), {
    tldr: "摘要",
    verdict: "值得閱讀",
    notes: "第一點\n第二點",
    suggestedTags: ["網路", "標準"],
    limitations: "僅供示範",
    sourceUrl: "https://example.com",
  });
});

test("rejects parseable but incomplete research JSON", () => {
  assert.throws(
    () => parseResearchResult("{}", "https://example.com", "openrouter"),
    (error) => {
      assert.ok(error instanceof ExternalServiceError);
      assert.equal(error.reason, "invalid_result");
      assert.equal(error.retryable, true);
      return true;
    },
  );
});

test("rejects research text contaminated by unsupported writing systems", () => {
  assert.equal(isSupportedResearchText("繁體中文與 API 2.0"), true);
  assert.equal(isSupportedResearchText("文件ాలకు"), false);
  assert.throws(
    () => parseResearchResult(JSON.stringify({
      tldr: "這是專고요摘要",
      verdict: "值得閱讀",
      notes: "詳細重點",
      suggestedTags: ["文件"],
      limitations: "無",
    }), "https://example.com", "openrouter"),
    (error) => error.reason === "invalid_result" && error.retryable === true,
  );
});

test("research schema requires every non-empty field and at least one tag", () => {
  assert.deepEqual(RESEARCH_RESULT_SCHEMA.required, [
    "tldr", "verdict", "notes", "suggestedTags", "limitations",
  ]);
  assert.equal(RESEARCH_RESULT_SCHEMA.additionalProperties, false);
  assert.equal(RESEARCH_RESULT_SCHEMA.properties.tldr.minLength, 1);
  assert.equal(RESEARCH_RESULT_SCHEMA.properties.suggestedTags.minItems, 1);
});

test("extracts text from Gemini generateContent and Interactions shapes", () => {
  assert.equal(extractGenerateContentText({
    candidates: [{content: {parts: [{text: "one"}, {text: "two"}]}}],
  }), "one\ntwo");
  assert.equal(extractInteractionText({
    steps: [{content: [{text: "video result"}]}],
  }), "video result");
  assert.equal(extractInteractionText({output_text: "direct"}), "direct");
  assert.equal(extractOpenRouterText({
    choices: [{message: {content: "{\"tldr\":\"摘要\"}"}}],
  }), "{\"tldr\":\"摘要\"}");
});

test("selects only free structured text models and honors a free preference", () => {
  const models = [
    {
      id: "paid/model",
      context_length: 100_000,
      pricing: {prompt: "0.001", completion: "0.001"},
      architecture: {input_modalities: ["text"]},
      supported_parameters: ["response_format"],
    },
    {
      id: "free/short",
      context_length: 8_000,
      pricing: {prompt: "0", completion: "0"},
      architecture: {input_modalities: ["text"]},
      supported_parameters: ["response_format"],
    },
    {
      id: "free/plain",
      context_length: 32_000,
      pricing: {prompt: "0", completion: "0"},
      architecture: {input_modalities: ["text"]},
      supported_parameters: ["temperature"],
    },
    {
      id: "free/qwen",
      context_length: 64_000,
      pricing: {prompt: "0", completion: "0"},
      architecture: {input_modalities: ["text"]},
      supported_parameters: ["response_format", "structured_outputs"],
    },
    {
      id: "free/mistral",
      context_length: 32_000,
      pricing: {prompt: "0", completion: "0"},
      architecture: {input_modalities: ["text"]},
      supported_parameters: ["response_format", "structured_outputs"],
    },
  ];
  assert.equal(isFreeTextModel(models[0]), false);
  assert.equal(isFreeTextModel(models[1]), false);
  assert.equal(isFreeTextModel(models[3]), true);
  assert.deepEqual(
    selectOpenRouterFreeModels(models, "free/mistral").map((model) => model.id),
    ["free/mistral", "free/qwen"],
  );
});

test("builds a concise manual NotebookLM result for YouTube", () => {
  const result = buildUnparsedYouTubeResult("https://youtu.be/DTKR9d0GpYs");
  assert.equal(result.provider, "notebooklm-manual");
  assert.deepEqual(result.suggestedTags, ["尚未解析的影片"]);
  assert.match(result.limitations, /尚未分析/);
});

test("does not retry a Gemini 429 caused by depleted prepayment credits", () => {
  const error = serviceErrorFromResponse("gemini", {
    status: 429,
    headers: new Headers(),
  }, "Your prepayment credits are depleted. Please manage billing.");
  assert.equal(error.retryable, false);
  assert.equal(error.reason, "billing_credits_depleted");
});

test("still retries an ordinary provider rate-limit response", () => {
  const error = serviceErrorFromResponse("gemini", {
    status: 429,
    headers: new Headers({"retry-after": "60"}),
  }, "Too many requests");
  assert.equal(error.retryable, true);
  assert.equal(error.reason, "");
  assert.equal(error.retryAfterSeconds, 60);
});

test("stops OpenRouter authentication and billing failures", () => {
  const authentication = serviceErrorFromResponse("openrouter", {
    status: 401,
    headers: new Headers(),
  }, "Invalid API key");
  assert.equal(authentication.retryable, false);
  assert.equal(authentication.reason, "authentication_failed");

  const billing = serviceErrorFromResponse("openrouter", {
    status: 402,
    headers: new Headers(),
  }, "Payment required");
  assert.equal(billing.retryable, false);
  assert.equal(billing.reason, "billing_credits_depleted");
});
