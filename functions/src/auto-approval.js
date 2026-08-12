"use strict";

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeTagName(value) {
  return normalizeText(value).replace(/\s+/g, " ").slice(0, 40);
}

function normalizeSearchText(value) {
  return String(value || "")
    .replace(/\r?\n[ \t]*/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim()
    .toLocaleLowerCase("zh-Hant");
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function createTagId(name, catalog) {
  const normalizedName = normalizeTagName(name).toLocaleLowerCase("zh-Hant");
  const baseId = `tag-${hashString(normalizedName)}`;
  let candidate = baseId;
  let suffix = 2;
  while (catalog.some((tag) =>
    tag.id === candidate &&
    tag.name.toLocaleLowerCase("zh-Hant") !== normalizedName)) {
    candidate = `${baseId}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function formatResearchNote(result = {}) {
  const sections = [];
  const tldr = normalizeText(result.tldr);
  const verdict = normalizeText(result.verdict);
  const notes = normalizeText(result.notes);
  const limitations = normalizeText(result.limitations);
  const sourceUrl = normalizeText(result.sourceUrl);
  if (tldr) sections.push(`TL;DR：${tldr}`);
  if (verdict) sections.push(`一句話評價：${verdict}`);
  if (notes) sections.push(notes);
  if (limitations) sections.push(`限制：${limitations}`);
  if (sourceUrl) sections.push(`來源：${sourceUrl}`);
  return sections.join("\n\n").trim() || "雲端研讀沒有回傳可用內容。";
}

function escapeEditorText(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
    .replace(/\r?\n/g, "<br>");
}

function formatResearchTimestamp(now) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(now));
}

function buildNoteData(existingData, note, now) {
  const base = existingData && typeof existingData === "object" ?
    {...existingData} :
    {time: now};
  const blocks = Array.isArray(existingData?.blocks) ? existingData.blocks : [];
  return {
    ...base,
    blocks: [
      ...blocks,
      {
        type: "header",
        data: {text: `AI 網址研讀｜${formatResearchTimestamp(now)}`, level: 2},
      },
      {type: "paragraph", data: {text: escapeEditorText(note)}},
    ],
  };
}

function buildTags(catalog, existingCardTagIds, suggestedTags) {
  const normalizedCatalog = [];
  const ids = new Set();
  const names = new Set();
  for (const rawTag of Array.isArray(catalog) ? catalog : []) {
    const id = normalizeText(rawTag?.id);
    const name = normalizeTagName(rawTag?.name);
    const normalizedName = name.toLocaleLowerCase("zh-Hant");
    if (!id || !name || ids.has(id) || names.has(normalizedName)) continue;
    normalizedCatalog.push({id, name});
    ids.add(id);
    names.add(normalizedName);
  }

  const cardTagIds = (Array.isArray(existingCardTagIds) ? existingCardTagIds : [])
    .map(String)
    .filter((id, index, values) => ids.has(id) && values.indexOf(id) === index);
  for (const rawName of Array.isArray(suggestedTags) ? suggestedTags : []) {
    const name = normalizeTagName(rawName);
    if (!name || /^tag-[a-z0-9]{5,}(?:-\d+)?$/i.test(name)) continue;
    const normalizedName = name.toLocaleLowerCase("zh-Hant");
    let tag = normalizedCatalog.find((item) =>
      item.name.toLocaleLowerCase("zh-Hant") === normalizedName);
    if (!tag) {
      tag = {id: createTagId(name, normalizedCatalog), name};
      normalizedCatalog.push(tag);
    }
    if (!cardTagIds.includes(tag.id)) cardTagIds.push(tag.id);
  }
  return {catalog: normalizedCatalog, cardTagIds};
}

function buildAutoApprovalWrites({
  card = {},
  noteData = null,
  tags = [],
  result = {},
  now = Date.now(),
} = {}) {
  const note = formatResearchNote(result);
  const resolvedTags = buildTags(tags, card.tagIds, result.suggestedTags);
  const researchParts = [card.researchSearchText, note]
    .map(normalizeSearchText)
    .filter(Boolean);
  return {
    noteData: buildNoteData(noteData, note, now),
    cardData: {
      tagIds: resolvedTags.cardTagIds,
      cardSearchText: normalizeSearchText(card.text),
      researchSearchText: researchParts.join("\n"),
      updatedAt: now,
    },
    tags: resolvedTags.catalog,
    tagsUpdatedAt: now,
  };
}

function shouldAutoApproveJob(job = {}) {
  return job.approvalMode === "auto" && job.sourceKind === "web";
}

module.exports = {
  buildAutoApprovalWrites,
  formatResearchNote,
  shouldAutoApproveJob,
};
