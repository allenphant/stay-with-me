"use strict";

const DEFAULT_SYSTEM_PROMPT = [
  "你是可靠的繁體中文研究助理。",
  "只根據提供的來源整理，不得補寫來源沒有提到的事實。",
  "回傳 JSON，不要 Markdown。",
  "只能使用 tldr、verdict、notes、suggestedTags、limitations 這五個固定鍵名。",
  "tldr、verdict、notes、limitations 都不可為空；若沒有已知限制，limitations 請填『無』。",
  "suggestedTags 最多 5 個簡短繁體中文詞彙。",
  "若來源有影片但無法解析，必須在 limitations 明確說明。",
].join("\n");

const RESEARCH_RESULT_SCHEMA = {
  type: "object",
  properties: {
    tldr: {
      type: "string",
      minLength: 1,
      description: "來源內容的一句繁體中文摘要。",
    },
    verdict: {
      type: "string",
      minLength: 1,
      description: "這份來源的價值、適用情境或是否值得深入閱讀。",
    },
    notes: {
      type: "string",
      minLength: 1,
      description: "只根據來源整理的詳細繁體中文重點。",
    },
    suggestedTags: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: {type: "string", minLength: 1},
      description: "1 到 5 個簡短繁體中文標籤。",
    },
    limitations: {
      type: "string",
      minLength: 1,
      description: "資料限制；若沒有已知限制請填『無』。",
    },
  },
  required: ["tldr", "verdict", "notes", "suggestedTags", "limitations"],
  additionalProperties: false,
};

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_APP_URL = "https://allenphant.github.io/stay-with-me/";
const OPENROUTER_APP_NAME = "stay-with-me";
const AUTO_FREE_MODEL = "auto:free";
const FREE_MODEL_CACHE_TTL_MS = 60 * 60 * 1000;
let cachedFreeModels = null;
let cachedFreeModelsAt = 0;

class ExternalServiceError extends Error {
  constructor(message, {
    provider,
    status = 0,
    retryable = false,
    retryAfterSeconds = 0,
    details = "",
    reason = "",
  } = {}) {
    super(message);
    this.name = "ExternalServiceError";
    this.provider = provider || "unknown";
    this.status = status;
    this.retryable = retryable;
    this.retryAfterSeconds = retryAfterSeconds;
    this.details = details;
    this.reason = reason;
  }
}

function parseRetryAfter(response) {
  const raw = response.headers.get("retry-after");
  if (!raw) return 0;
  const seconds = Number.parseInt(raw, 10);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? Math.max(0, Math.ceil((timestamp - Date.now()) / 1000)) : 0;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 90_000) {
  const {provider = "unknown", ...fetchOptions} = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {...fetchOptions, signal: controller.signal});
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new ExternalServiceError("外部服務逾時", {
        provider,
        retryable: true,
      });
    }
    throw new ExternalServiceError(error?.message || "外部服務連線失敗", {
      provider,
      retryable: true,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function parseErrorResponse(response) {
  const text = await response.text().catch(() => "");
  try {
    const parsed = JSON.parse(text);
    return parsed.error?.message || parsed.message || text;
  } catch {
    return text.slice(0, 1000);
  }
}

function serviceErrorFromResponse(provider, response, details) {
  const normalizedDetails = String(details || "").toLowerCase();
  const depletedPrepayment =
    response.status === 429 &&
    normalizedDetails.includes("prepayment credits are depleted");
  const authenticationFailed = response.status === 401 || response.status === 403;
  const billingUnavailable = response.status === 402;
  const modelUnavailable = response.status === 404;
  const retryable =
    !depletedPrepayment && !authenticationFailed && !billingUnavailable && !modelUnavailable &&
    (response.status === 429 || response.status >= 500);
  let reason = "";
  if (depletedPrepayment || billingUnavailable) reason = "billing_credits_depleted";
  else if (authenticationFailed) reason = "authentication_failed";
  else if (modelUnavailable) reason = "model_unavailable";
  return new ExternalServiceError(`${provider} HTTP ${response.status}`, {
    provider,
    status: response.status,
    retryable,
    retryAfterSeconds: parseRetryAfter(response),
    details,
    reason,
  });
}

async function readWithJina(sourceUrl, apiKey = "") {
  const headers = {
    Accept: "text/plain",
    "X-Return-Format": "markdown",
    "X-Remove-Selector": "header, footer, nav, script, style",
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const response = await fetchWithTimeout(
    `https://r.jina.ai/${sourceUrl}`,
    {headers, provider: "jina"},
    90_000,
  );
  if (!response.ok) {
    throw serviceErrorFromResponse("jina", response, await parseErrorResponse(response));
  }
  const text = (await response.text()).trim();
  if (!text) {
    throw new ExternalServiceError("Jina Reader 沒有回傳可整理文字", {
      provider: "jina",
      retryable: false,
    });
  }
  return text.slice(0, 120_000);
}

function stripJsonFence(text) {
  return String(text || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function firstDefined(value, keys) {
  for (const key of keys) {
    if (value?.[key] !== undefined && value[key] !== null) return value[key];
  }
  return "";
}

function normalizeNarrative(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean).join("\n");
  }
  return String(value || "").trim();
}

function normalizeSuggestedTags(value) {
  const tags = Array.isArray(value) ?
    value :
    String(value || "").split(/[,，、]/);
  return tags
    .map((tag) => typeof tag === "object" ? tag?.name || tag?.label : tag)
    .map((tag) => String(tag || "").trim())
    .filter(Boolean)
    .slice(0, 5);
}

function unwrapResearchResult(value) {
  const parsed = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const nested = [parsed.result, parsed.research, parsed.output, parsed.data]
    .find((candidate) => candidate && typeof candidate === "object" && !Array.isArray(candidate));
  return nested || parsed;
}

function normalizeResearchResult(value, sourceUrl) {
  const parsed = unwrapResearchResult(value);
  return {
    tldr: normalizeNarrative(firstDefined(parsed, [
      "tldr", "summary", "shortSummary", "overview", "摘要", "總結",
    ])),
    verdict: normalizeNarrative(firstDefined(parsed, [
      "verdict", "assessment", "recommendation", "conclusion", "評價", "建議", "結論",
    ])),
    notes: normalizeNarrative(firstDefined(parsed, [
      "notes", "detailedNotes", "keyPoints", "analysis", "content", "筆記", "重點",
    ])),
    suggestedTags: normalizeSuggestedTags(firstDefined(parsed, [
      "suggestedTags", "suggested_tags", "tags", "keywords", "建議標籤", "標籤",
    ])),
    limitations: normalizeNarrative(firstDefined(parsed, [
      "limitations", "caveats", "constraints", "限制", "侷限",
    ])),
    sourceUrl,
  };
}

function isCompleteResearchResult(result) {
  return [result?.tldr, result?.verdict, result?.notes, result?.limitations]
    .every((value) => String(value || "").trim()) &&
    Array.isArray(result?.suggestedTags) && result.suggestedTags.length > 0;
}

function parseResearchResult(text, sourceUrl, provider) {
  let parsed;
  try {
    parsed = JSON.parse(stripJsonFence(text));
  } catch {
    throw new ExternalServiceError(`${provider} 回傳的 JSON 無法解析`, {
      provider,
      retryable: false,
      reason: "invalid_json",
      details: String(text || "").slice(0, 500),
    });
  }
  const result = normalizeResearchResult(parsed, sourceUrl);
  if (!isCompleteResearchResult(result)) {
    throw new ExternalServiceError(`${provider} 回傳的研讀欄位不完整`, {
      provider,
      retryable: true,
      retryAfterSeconds: 60,
      reason: "invalid_result",
      details: String(text || "").slice(0, 500),
    });
  }
  return result;
}

function extractGenerateContentText(data) {
  return data?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("\n")
    .trim() || "";
}

function extractInteractionText(data) {
  if (typeof data?.output_text === "string") return data.output_text;
  const stepTexts = (data?.steps || []).flatMap((step) =>
    (step?.content || []).map((part) => part?.text || ""),
  );
  const outputTexts = (data?.outputs || []).flatMap((output) =>
    (output?.content || []).map((part) => part?.text || ""),
  );
  return [...stepTexts, ...outputTexts].filter(Boolean).join("\n").trim();
}

function extractOpenRouterText(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => typeof part === "string" ? part : part?.text || "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

function isZeroPrice(value) {
  return value !== null && value !== undefined && value !== "" && Number(value) === 0;
}

function isFreeTextModel(model) {
  const pricing = model?.pricing || {};
  if (!isZeroPrice(pricing.prompt) || !isZeroPrice(pricing.completion)) return false;
  const modalities = model?.architecture?.input_modalities;
  if (Array.isArray(modalities) && modalities.length && !modalities.includes("text")) {
    return false;
  }
  const supported = model?.supported_parameters;
  if (Array.isArray(supported) && supported.length &&
      !supported.includes("structured_outputs")) {
    return false;
  }
  return Number(model?.context_length || 0) >= 16_000;
}

function scoreFreeModel(model) {
  const id = String(model?.id || "").toLowerCase();
  const supported = Array.isArray(model?.supported_parameters) ?
    model.supported_parameters :
    [];
  let score = Math.min(Number(model?.context_length || 0), 200_000) / 10_000;
  if (supported.includes("structured_outputs")) score += 180;
  if (supported.includes("response_format")) score += 20;
  if (/mistral|qwen|gemma|llama|nemotron/.test(id)) score += 20;
  if (/instruct|chat/.test(id)) score += 10;
  return score;
}

function selectOpenRouterFreeModels(models, configuredModel = AUTO_FREE_MODEL) {
  const freeModels = (Array.isArray(models) ? models : [])
    .filter(isFreeTextModel)
    .sort((left, right) =>
      scoreFreeModel(right) - scoreFreeModel(left) ||
      String(left.id || "").localeCompare(String(right.id || "")),
    );
  if (!freeModels.length) return [];
  if (configuredModel && configuredModel !== AUTO_FREE_MODEL) {
    const configured = freeModels.find((model) => model.id === configuredModel);
    if (configured) {
      return [configured, ...freeModels.filter((model) => model.id !== configuredModel)];
    }
  }
  return freeModels;
}

async function listOpenRouterFreeModels(apiKey, configuredModel = AUTO_FREE_MODEL) {
  const now = Date.now();
  if (cachedFreeModels && now - cachedFreeModelsAt < FREE_MODEL_CACHE_TTL_MS) {
    return selectOpenRouterFreeModels(cachedFreeModels, configuredModel);
  }
  const response = await fetchWithTimeout(OPENROUTER_MODELS_URL, {
    provider: "openrouter",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  }, 30_000);
  if (!response.ok) {
    throw serviceErrorFromResponse(
      "openrouter",
      response,
      await parseErrorResponse(response),
    );
  }
  const payload = await response.json();
  cachedFreeModels = Array.isArray(payload?.data) ? payload.data : [];
  cachedFreeModelsAt = now;
  const selected = selectOpenRouterFreeModels(cachedFreeModels, configuredModel);
  if (!selected.length) {
    throw new ExternalServiceError("OpenRouter 目前沒有符合條件的免費文字模型", {
      provider: "openrouter",
      retryable: true,
      retryAfterSeconds: 60 * 60,
      reason: "no_free_model",
    });
  }
  return selected;
}

async function analyzeWebSourceWithOpenRouter({
  sourceUrl,
  openRouterApiKey,
  jinaApiKey = "",
  openRouterModel = AUTO_FREE_MODEL,
  systemPrompt = DEFAULT_SYSTEM_PROMPT,
}) {
  const sourceText = await readWithJina(sourceUrl, jinaApiKey);
  const freeModels = await listOpenRouterFreeModels(openRouterApiKey, openRouterModel);
  const selectedModel = freeModels[0].id;
  const fallbackModels = freeModels.slice(0, 3).map((candidate) => candidate.id);
  const response = await fetchWithTimeout(OPENROUTER_CHAT_URL, {
    method: "POST",
    provider: "openrouter",
    headers: {
      Authorization: `Bearer ${openRouterApiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": OPENROUTER_APP_URL,
      "X-Title": OPENROUTER_APP_NAME,
    },
    body: JSON.stringify({
      models: fallbackModels,
      messages: [
        {role: "system", content: systemPrompt},
        {
          role: "user",
          content: `請整理以下來源。\n來源網址：${sourceUrl}\n\n來源文字：\n${sourceText}`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "research_result",
          strict: true,
          schema: RESEARCH_RESULT_SCHEMA,
        },
      },
      temperature: 0.1,
      provider: {
        allow_fallbacks: true,
        require_parameters: true,
      },
    }),
  }, 120_000);
  if (!response.ok) {
    throw serviceErrorFromResponse(
      "openrouter",
      response,
      await parseErrorResponse(response),
    );
  }
  const data = await response.json();
  const text = extractOpenRouterText(data);
  if (!text) {
    throw new ExternalServiceError("OpenRouter 沒有回傳內容", {
      provider: "openrouter",
      retryable: false,
      reason: "empty_response",
    });
  }
  return {
    ...parseResearchResult(text, sourceUrl, "openrouter"),
    provider: "jina+openrouter",
    model: String(data?.model || selectedModel),
  };
}

function buildUnparsedYouTubeResult(sourceUrl) {
  return {
    tldr: "影片尚未解析。",
    verdict: "請使用 NotebookLM 或其他影片工具手動研讀。",
    notes: "影片無法由目前的自動文字研讀流程解析。",
    suggestedTags: ["尚未解析的影片"],
    limitations: "尚未分析影片字幕、聲音或畫面。",
    sourceUrl,
    provider: "notebooklm-manual",
    model: "",
  };
}

async function analyzeWebSource({
  sourceUrl,
  geminiApiKey,
  jinaApiKey = "",
  model,
  systemPrompt = DEFAULT_SYSTEM_PROMPT,
}) {
  const sourceText = await readWithJina(sourceUrl, jinaApiKey);
  const response = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      provider: "gemini",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": geminiApiKey,
      },
      body: JSON.stringify({
        systemInstruction: {parts: [{text: systemPrompt}]},
        contents: [{
          role: "user",
          parts: [{
            text: `請整理以下來源。\n來源網址：${sourceUrl}\n\n來源文字：\n${sourceText}`,
          }],
        }],
        generationConfig: {
          responseMimeType: "application/json",
        },
      }),
    },
    120_000,
  );
  if (!response.ok) {
    throw serviceErrorFromResponse("gemini", response, await parseErrorResponse(response));
  }
  const data = await response.json();
  const text = extractGenerateContentText(data);
  if (!text) {
    throw new ExternalServiceError("Gemini 沒有回傳內容", {
      provider: "gemini",
      retryable: false,
    });
  }
  return parseResearchResult(text, sourceUrl, "gemini");
}

async function analyzeYouTubeSource({
  sourceUrl,
  geminiApiKey,
  model,
  systemPrompt = DEFAULT_SYSTEM_PROMPT,
}) {
  const response = await fetchWithTimeout(
    "https://generativelanguage.googleapis.com/v1beta/interactions",
    {
      method: "POST",
      provider: "gemini-video",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": geminiApiKey,
      },
      body: JSON.stringify({
        model,
        system_instruction: systemPrompt,
        input: [
          {type: "video", uri: sourceUrl},
          {
            type: "text",
            text: [
              "分析此影片的聲音與畫面。",
              "回傳 JSON：tldr、verdict、notes、suggestedTags、limitations。",
              "notes 應包含重要時間點；無法存取影片時不可猜測。",
            ].join("\n"),
          },
        ],
      }),
    },
    240_000,
  );
  if (!response.ok) {
    throw serviceErrorFromResponse(
      "gemini-video",
      response,
      await parseErrorResponse(response),
    );
  }
  const data = await response.json();
  const text = extractInteractionText(data);
  if (!text) {
    throw new ExternalServiceError("Gemini Video 沒有回傳內容", {
      provider: "gemini-video",
      retryable: false,
    });
  }
  try {
    return normalizeResearchResult(JSON.parse(stripJsonFence(text)), sourceUrl);
  } catch {
    throw new ExternalServiceError("Gemini Video 回傳的 JSON 無法解析", {
      provider: "gemini-video",
      retryable: false,
      details: text.slice(0, 500),
    });
  }
}

async function analyzeSource(options) {
  if (options.sourceKind === "youtube") {
    return buildUnparsedYouTubeResult(options.sourceUrl);
  }
  if (options.openRouterApiKey) {
    return analyzeWebSourceWithOpenRouter(options);
  }
  if (!options.geminiApiKey) {
    throw new ExternalServiceError("尚未設定 OPENROUTER_API_KEY", {
      provider: "openrouter",
      status: 401,
      retryable: false,
      reason: "authentication_failed",
    });
  }
  return analyzeWebSource(options);
}

module.exports = {
  AUTO_FREE_MODEL,
  DEFAULT_SYSTEM_PROMPT,
  RESEARCH_RESULT_SCHEMA,
  ExternalServiceError,
  analyzeSource,
  analyzeWebSource,
  analyzeWebSourceWithOpenRouter,
  analyzeYouTubeSource,
  buildUnparsedYouTubeResult,
  extractGenerateContentText,
  extractInteractionText,
  extractOpenRouterText,
  isFreeTextModel,
  isCompleteResearchResult,
  listOpenRouterFreeModels,
  normalizeResearchResult,
  parseResearchResult,
  readWithJina,
  selectOpenRouterFreeModels,
  serviceErrorFromResponse,
  stripJsonFence,
};
