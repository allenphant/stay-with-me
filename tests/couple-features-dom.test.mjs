import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const features = readFileSync(new URL('../couple-features.mjs', import.meta.url), 'utf8');
const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');

test('couple-life hub exposes each shared feature exactly once', () => {
    const ids = [
        'couple-life-hub', 'couple-token-balance', 'daily-question-form', 'daily-question-prompt',
        'daily-question-input', 'daily-question-submit', 'daily-question-answers',
        'daily-diary-form', 'daily-diary-date', 'daily-diary-input', 'daily-diary-submit',
        'daily-diary-list', 'weekly-review-panel', 'weekly-review-generate', 'weekly-review-content',
        'shared-whiteboard-panel', 'shared-whiteboard-note-form', 'shared-whiteboard-note-input',
        'shared-whiteboard-todo-form', 'shared-whiteboard-todo-input', 'shared-whiteboard-list'
    ];
    for (const id of ids) {
        const occurrences = html.match(new RegExp(`\\bid="${id}"`, 'g')) || [];
        assert.equal(occurrences.length, 1, `${id} should appear exactly once`);
    }
});

test('settings are split into shared-space and AI panels without changing existing control ids', () => {
    assert.match(html, /id="settings-modal"[^>]*role="dialog"[^>]*aria-modal="true"/);
    assert.match(html, /id="settings-tab-space"[^>]*role="tab"/);
    assert.match(html, /id="settings-tab-ai"[^>]*role="tab"/);
    assert.match(html, /id="settings-panel-space"[^>]*role="tabpanel"/);
    assert.match(html, /id="settings-panel-ai"[^>]*role="tabpanel"[^>]*hidden/);
    assert.match(app, /function setSettingsPanel\(panel = 'space'\)/);
    assert.match(app, /openSettingsModal\('ai'\)/);
});

test('couple-life listeners attach to the active space and expose the sidebar destination', () => {
    assert.match(app, /import \{ createCoupleFeatures \} from '\.\/couple-features\.mjs'/);
    assert.match(app, /coupleFeatures\.attachSpace\(spaceId\)/);
    assert.match(app, /coupleFeatures\.detach\(\)/);
    assert.match(app, /createSidebarLink\('couple-life-hub', 'fas fa-heart-pulse', '一起生活'\)/);
    assert.match(app, /\.category-wrapper, #couple-planner, #couple-life-hub/);
});

test('feature module routes money and private content through trusted callables', () => {
    for (const callable of ['ensureTokenWallet', 'submitDailyAnswer', 'saveDailyDiary', 'unlockDailyDiary', 'saveWeeklyReview']) {
        assert.match(features, new RegExp(`call\\('${callable}'`), `${callable} should be called by the feature module`);
    }
    assert.match(features, /getDoc\(doc\(db, \.\.\.rootPath\(\), 'diaries', diary\.id, 'content', 'private'\)\)/);
    assert.match(features, /localStorage\.getItem\('geminiApiKey'\)/);
});

test('Firestore rules protect token, diary, review, and whiteboard boundaries', () => {
    for (const collectionName of ['tokens', 'dailyQuestions', 'diaries', 'weeklyReviews', 'whiteboardBlocks']) {
        assert.match(rules, new RegExp(`collectionName != "${collectionName}"`));
    }
    assert.match(rules, /diaries\/\{diaryId\}\/content\/\{document=\*\*\}/);
    assert.match(rules, /allow write: if false;/);
    assert.match(rules, /whiteboardBlocks\/\{document=\*\*\}/);
});
