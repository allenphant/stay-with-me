import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');

test('planner controls referenced by the app exist exactly once', () => {
    const ids = [
        'couple-planner', 'planner-month-label', 'planner-month-toggle',
        'planner-month-jump-container', 'planner-month-jump', 'planner-month-input',
        'planner-month-cancel', 'planner-prev-month', 'planner-next-month',
        'planner-today', 'planner-upcoming', 'planner-calendar', 'planner-wishes',
        'planner-calendar-shell', 'planner-agenda', 'planner-agenda-title',
        'planner-agenda-date', 'planner-agenda-prev', 'planner-agenda-next',
        'planner-agenda-list', 'planner-agenda-add', 'planner-collaborators',
        'planner-last-synced', 'planner-sync-status', 'planner-sync-retry',
        'anniversary-form', 'anniversary-title', 'anniversary-date', 'anniversary-list',
        'anniversary-submit', 'anniversary-cancel-edit',
        'add-plan-fields', 'add-plan-kind', 'add-plan-date',
        'edit-plan-fields', 'edit-plan-kind', 'edit-plan-date',
        'planner-entry-type', 'planner-entry-category', 'planner-entry-plan-fields',
        'planner-entry-event-fields', 'planner-entry-date-hint', 'planner-entry-open-editor',
        'planner-add-event', 'calendar-event-modal', 'calendar-event-form',
        'calendar-event-title', 'calendar-event-date', 'calendar-event-start',
        'calendar-event-end', 'calendar-event-location', 'calendar-event-notes',
        'calendar-event-error', 'calendar-event-delete', 'calendar-event-cancel', 'calendar-event-save'
    ];
    for (const id of ids) {
        const occurrences = html.match(new RegExp(`\\bid="${id}"`, 'g')) || [];
        assert.equal(occurrences.length, 1, `${id} should appear exactly once`);
    }
});

test('anniversary form uses native required fields and mobile has a selected-date agenda', () => {
    assert.match(html, /id="anniversary-title"[^>]*\brequired\b/);
    assert.match(html, /id="anniversary-date"[^>]*\brequired\b/);
    assert.match(html, /id="planner-calendar-shell"[^>]*\bmd:block/);
    assert.match(html, /id="planner-agenda"[^>]*\bmd:hidden/);
    assert.match(html, /id="planner-agenda-date"[^>]*type="date"/);
    assert.match(html, /id="planner-agenda-list"[^>]*aria-live="polite"/);
});

test('planner exposes sync, collaborators, last-synced metadata and retry controls', () => {
    assert.match(html, /id="planner-collaborators"/);
    assert.match(html, /id="planner-last-synced"/);
    assert.match(html, /id="planner-sync-status"[^>]*aria-live="polite"/);
    assert.match(html, /id="planner-sync-retry"[^>]*\bhidden\b/);
    assert.match(app, /includeMetadataChanges: true/);
    assert.match(app, /retryPlannerSync/);
    assert.match(app, /plannerSnapshotState/);
    assert.match(app, /PLANNER_SYNC_TIMEOUT_MS/);
    assert.match(app, /schedulePlannerSyncTimeout/);
    assert.match(app, /resetPlannerPlanSyncState/);
    assert.match(app, /離線快取/);
});

test('unified planner editor has required title/date and dialog semantics', () => {
    assert.match(html, /id="calendar-event-modal"[^>]*role="dialog"[^>]*aria-modal="true"/);
    assert.match(html, /id="calendar-event-title"[^>]*\brequired\b/);
    assert.match(html, /id="calendar-event-date"[^>]*\brequired\b/);
    assert.match(html, /id="planner-entry-type"[\s\S]*value="event"[\s\S]*value="task"[\s\S]*value="wish"[\s\S]*value="date"/);
    assert.match(html, /id="planner-entry-category"/);
});

test('month heading opens an accessible, native month picker', () => {
    assert.match(html, /id="planner-month-toggle"[^>]*aria-expanded="false"[^>]*aria-controls="planner-month-jump"/);
    assert.match(html, /id="planner-month-jump"[^>]*hidden/);
    assert.match(html, /id="planner-month-input"[^>]*type="month"[^>]*required/);
    assert.match(app, /monthJumpToggle\.addEventListener\('click'/);
    assert.match(app, /monthJumpForm\.addEventListener\('submit'/);
});

test('calendar day cells open scheduling while existing entries retain their actions', () => {
    assert.match(app, /class="planner-calendar-day[^`]*data-date="\$\{key\}"/);
    assert.match(app, /event\.target\.closest\('\.calendar-event-entry'\)/);
    assert.match(app, /event\.target\.closest\('\.planner-entry'\)/);
    assert.match(app, /event\.target\.closest\('\.planner-calendar-day'\)/);
    assert.match(app, /openPlannerEntryModal\(null, '', dayCell\.dataset\.date, 'event'\)/);
    assert.match(app, /calendar-anniversary-entry/);
    assert.match(app, /planner-agenda-date/);
});

test('planner metadata keeps creator information visible in agenda and new records', () => {
    assert.match(app, /建立者：\$\{escapeHtml\(creator\)\}/);
    assert.match(app, /createdByUid: currentUser\.uid/);
    assert.match(app, /edit-anniversary/);
    assert.match(app, /historyManager\.push\(\{/);
});

test('primary text inputs, keys, contenteditable and icon controls have accessible names', () => {
    assert.match(html, /id="idea-input"[^>]*aria-label="快速新增內容"/);
    assert.match(html, /id="cat-prompt-rule-input"[^>]*aria-label="分類規則"/);
    assert.match(html, /id="api-key-input"[^>]*aria-label="Google Gemini API Key"/);
    assert.match(html, /id="mistral-api-key-input"[^>]*aria-label="Mistral API Key"/);
    assert.match(html, /id="jina-api-key-input"[^>]*aria-label="Jina Reader API Key"/);
    assert.match(html, /id="imgbb-key-input"[^>]*aria-label="ImgBB API Key"/);
    assert.match(html, /id="editor-title"[^>]*role="textbox"[^>]*aria-label="卡片標題"/);
    assert.match(html, /id="image-preview-img"[^>]*alt="待上傳圖片預覽"/);
    assert.match(html, /prefers-reduced-motion/);
    assert.match(app, /aria-label="複製卡片"/);
    assert.match(app, /請先登入，才能新增共同內容/);
});

test('fixed CDN assets use SRI and documented runtime exceptions', () => {
    const fixedScripts = [
        'https://cdn.jsdelivr.net/npm/sortablejs@1.15.0/Sortable.min.js',
        'https://cdn.jsdelivr.net/npm/@editorjs/editorjs@2.31.6',
        'https://cdn.jsdelivr.net/npm/@editorjs/header@2.8.9',
        'https://cdn.jsdelivr.net/npm/@editorjs/list@2.0.9',
        'https://cdn.jsdelivr.net/npm/@editorjs/checklist@1.6.0',
        'https://cdn.jsdelivr.net/npm/@editorjs/quote@2.7.6',
        'https://cdn.jsdelivr.net/npm/@editorjs/marker@1.4.0',
        'https://cdn.jsdelivr.net/npm/@editorjs/inline-code@1.5.2',
        'https://cdn.jsdelivr.net/npm/@editorjs/code@2.9.4',
        'https://cdn.jsdelivr.net/npm/@editorjs/delimiter@1.4.2',
        'https://cdn.jsdelivr.net/npm/editorjs-undo@2.0.28'
    ];
    for (const source of fixedScripts) {
        const escapedSource = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        assert.match(html, new RegExp(`<script src="${escapedSource}" integrity="sha384-[^"]+" crossorigin="anonymous" defer></script>`));
    }
    assert.match(html, /font-awesome\/6\.4\.0\/css\/all\.min\.css[^>]*integrity="sha384-[^"]+"[^>]*crossorigin="anonymous"/);
    assert.match(html, /Tailwind Play CDN is runtime-generated/);
    assert.match(html, /legacy helper is unversioned upstream/);
});

test('planner routes all plan entry creation and editing through one modal', () => {
    assert.match(app, /plannerEntryType\.addEventListener\('change', updatePlannerEntryForm\)/);
    assert.match(app, /openPlannerEntryModal\(item, button\.dataset\.col\)/);
    assert.match(app, /openPlannerEntryModal\(null, colId, '', 'task'\)/);
    assert.match(app, /normalizePlannerCard\(/);
    assert.match(app, /plannerEntryPlanFields\.classList\.toggle\('hidden', !isPlan\)/);
    assert.match(app, /plannerEntryEventFields\.classList\.toggle\('hidden', !isEvent\)/);
});

test('shared planner is the first home section and a first-level sidebar destination', () => {
    const headerEnd = html.indexOf('</header>');
    const plannerStart = html.indexOf('<section id="couple-planner"');
    const captureStart = html.indexOf('id="add-form"');
    const inboxStart = html.indexOf('data-name="收件匣"');
    assert.ok(headerEnd < plannerStart, 'planner should follow the page header');
    assert.ok(plannerStart < captureStart, 'planner should precede the capture input');
    assert.ok(plannerStart < inboxStart, 'planner should precede the inbox');
    assert.match(app, /createSidebarLink\('couple-planner', 'fas fa-calendar-days', '共同計畫'\)/);
    assert.match(app, /targetId === 'couple-planner'/);
    assert.match(app, /querySelectorAll\('\.category-wrapper, #couple-planner, #couple-life-hub'\)/);
});
