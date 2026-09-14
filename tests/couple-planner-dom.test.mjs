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
        'anniversary-form', 'anniversary-title', 'anniversary-date', 'anniversary-list',
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

test('anniversary form uses native required fields and the calendar can scroll on mobile', () => {
    assert.match(html, /id="anniversary-title"[^>]*\brequired\b/);
    assert.match(html, /id="anniversary-date"[^>]*\brequired\b/);
    assert.match(html, /class="overflow-x-auto pb-2"><div id="planner-calendar"/);
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
    assert.match(app, /querySelectorAll\('\.category-wrapper, #couple-planner'\)/);
});
