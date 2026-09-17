"use strict";

const TOKEN_POLICY = Object.freeze({
  welcomeGrant: 20,
  dailyAnswerReward: 5,
  dailyDiaryReward: 3,
  diaryCharactersPerToken: 20,
  diaryMinimumPrice: 3,
  diaryMaximumPrice: 30,
});

const GUINEA_PIG_FEEDS = Object.freeze({
  hay: Object.freeze({
    name: "高級牧草",
    cost: 3,
    hunger: 18,
    mood: 2,
    description: "每天都需要的安心主食。",
  }),
  vegetables: Object.freeze({
    name: "小蔬菜盤",
    cost: 5,
    hunger: 10,
    mood: 8,
    description: "補充水分，也讓今天心情更好。",
  }),
  treat: Object.freeze({
    name: "磨牙小點心",
    cost: 8,
    hunger: 5,
    mood: 15,
    description: "偶爾來一點，開心值大提升。",
  }),
});

const GUINEA_PIG_POLICY = Object.freeze({
  name: "小糰子",
  initialHunger: 72,
  initialMood: 68,
  initialHealth: 100,
  feeds: GUINEA_PIG_FEEDS,
});

const DAILY_QUESTIONS = Object.freeze([
  "最近有哪一個小瞬間，讓你覺得和對方一起生活很幸福？",
  "如果今天晚上多出兩個小時，你最想和對方一起做什麼？",
  "你希望對方最近多知道你心裡的哪一件事？",
  "你們下一次約會，最想留下什麼樣的回憶？",
  "最近有什麼事情值得兩個人一起慶祝？",
  "用三個詞形容你心中的理想週末。",
  "你想和對方一起學會什麼新技能？",
]);

function normalizeDateKey(value) {
  const normalized = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return "";
  const parsed = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) return "";
  return normalized;
}

function calculateDiaryPrice(characterCount) {
  const count = Math.max(0, Number.parseInt(characterCount, 10) || 0);
  return Math.min(
    TOKEN_POLICY.diaryMaximumPrice,
    Math.max(
      TOKEN_POLICY.diaryMinimumPrice,
      Math.ceil(count / TOKEN_POLICY.diaryCharactersPerToken),
    ),
  );
}

function questionForDate(dateKey) {
  const normalized = normalizeDateKey(dateKey);
  if (!normalized) return DAILY_QUESTIONS[0];
  const seed = normalized.split("-").join("").split("").reduce(
    (total, digit) => total + Number(digit),
    0,
  );
  return DAILY_QUESTIONS[seed % DAILY_QUESTIONS.length];
}

module.exports = {
  DAILY_QUESTIONS,
  GUINEA_PIG_FEEDS,
  GUINEA_PIG_POLICY,
  TOKEN_POLICY,
  calculateDiaryPrice,
  normalizeDateKey,
  questionForDate,
};
