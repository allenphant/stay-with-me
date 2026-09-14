import test from 'node:test';
import assert from 'node:assert/strict';
import {
    anniversaryOccurrence, getCalendarEntries, getPlanKind,
    getUpcomingAnniversaries, normalizeCalendarEvent, parseDateKey
} from '../couple-planner.mjs';

test('date keys reject invalid and non-existent calendar dates', () => {
    assert.deepEqual(parseDateKey('2028-02-29'), { year: 2028, month: 2, day: 29 });
    assert.equal(parseDateKey('2027-02-29'), null);
    assert.equal(parseDateKey('2026-13-01'), null);
    assert.equal(parseDateKey('2026-9-1'), null);
});

test('legacy todo cards remain ordinary tasks; wish scheduled as date stays one item', () => {
    assert.equal(getPlanKind({ text: '原有待辦' }), 'task');
    const groups = [{ id: 'todos', items: [
        { id: 'legacy', text: '原有待辦' },
        { id: 'wish', text: '去海邊', planKind: 'wish', planDate: '2026-09-20' }
    ] }];
    assert.deepEqual(getCalendarEntries(groups, [], 2026, 9), [{
        id: 'wish', collectionId: 'todos', title: '去海邊', date: '2026-09-20',
        kind: 'wish', completed: false
    }]);
    groups[0].items[1].planKind = 'date';
    assert.equal(getCalendarEntries(groups, [], 2026, 9).length, 1);
    assert.equal(getCalendarEntries(groups, [], 2026, 9)[0].kind, 'date');
});

test('anniversaries recur yearly, including leap-day fallback', () => {
    const item = { id: 'ann', title: '相遇', date: '2024-02-29' };
    assert.equal(anniversaryOccurrence(item, 2023), null);
    assert.equal(anniversaryOccurrence(item, 2025), '2025-02-28');
    assert.equal(anniversaryOccurrence(item, 2028), '2028-02-29');
    assert.deepEqual(getCalendarEntries([], [item], 2025, 2), [{
        id: 'ann', title: '相遇', date: '2025-02-28', kind: 'anniversary', completed: false
    }]);
});

test('upcoming anniversaries span new year without double counting', () => {
    const items = [
        { id: 'new-year', title: '跨年', date: '2020-01-01' },
        { id: 'old', title: '去年', date: '2020-12-01' }
    ];
    assert.deepEqual(getUpcomingAnniversaries(items, '2026-12-20', 15)
        .map(item => [item.id, item.occurrence]), [['new-year', '2027-01-01']]);
});

test('simple calendar events have no completion state and are ordered by time', () => {
    const events = [
        { id: 'dinner', title: '晚餐', date: '2026-09-20', startTime: '18:30', endTime: '20:00', location: '餐廳' },
        { id: 'walk', title: '散步', date: '2026-09-20', startTime: '09:00' },
        { id: 'other', title: '別月', date: '2026-10-01' }
    ];
    const entries = getCalendarEntries([], [], 2026, 9, events);
    assert.deepEqual(entries.map(item => item.id), ['walk', 'dinner']);
    assert.equal(entries[1].kind, 'event');
    assert.equal(entries[1].completed, false);
    assert.equal(entries[1].location, '餐廳');
});

test('simple events validate date, time order and optional fields', () => {
    assert.deepEqual(normalizeCalendarEvent({ title: '  看電影  ', date: '2026-09-20' }), {
        title: '看電影', date: '2026-09-20', startTime: '', endTime: '', location: '', notes: ''
    });
    assert.throws(() => normalizeCalendarEvent({ title: '電影', date: '2026-02-30' }), /有效日期/);
    assert.throws(() => normalizeCalendarEvent({ title: '電影', date: '2026-09-20', endTime: '12:00' }), /結束時間/);
    assert.throws(() => normalizeCalendarEvent({ title: '電影', date: '2026-09-20', startTime: '18:00', endTime: '17:00' }), /結束時間/);
    assert.throws(() => normalizeCalendarEvent({ title: '電影', date: '2026-09-20', startTime: '25:00' }), /開始時間/);
});
