import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('planner controls referenced by the app exist exactly once', () => {
    const ids = [
        'couple-planner', 'planner-month-label', 'planner-prev-month', 'planner-next-month',
        'planner-today', 'planner-upcoming', 'planner-calendar', 'planner-wishes',
        'anniversary-form', 'anniversary-title', 'anniversary-date', 'anniversary-list',
        'add-plan-fields', 'add-plan-kind', 'add-plan-date',
        'edit-plan-fields', 'edit-plan-kind', 'edit-plan-date',
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

test('standalone event editor has required title/date and dialog semantics', () => {
    assert.match(html, /id="calendar-event-modal"[^>]*role="dialog"[^>]*aria-modal="true"/);
    assert.match(html, /id="calendar-event-title"[^>]*\brequired\b/);
    assert.match(html, /id="calendar-event-date"[^>]*\brequired\b/);
});
