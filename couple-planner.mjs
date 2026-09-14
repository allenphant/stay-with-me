export const PLAN_KINDS = Object.freeze({ task: '待辦', wish: '願望', date: '約會' });

export function parseDateKey(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
        ? { year, month, day } : null;
}

export function dateKey(year, month, day) {
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function getPlanKind(item) {
    return Object.hasOwn(PLAN_KINDS, item?.planKind) ? item.planKind : 'task';
}

export function anniversaryOccurrence(anniversary, year) {
    const original = parseDateKey(anniversary?.date);
    if (!original || year < original.year) return null;
    // Leap-day anniversaries are observed on February 28 in non-leap years.
    const day = original.month === 2 && original.day === 29 && !parseDateKey(dateKey(year, 2, 29))
        ? 28 : original.day;
    return dateKey(year, original.month, day);
}

export function getCalendarEntries(todoGroups, anniversaries, year, month) {
    const entries = [];
    for (const group of todoGroups) {
        for (const item of group.items || []) {
            const date = parseDateKey(item.planDate);
            if (!date || date.year !== year || date.month !== month) continue;
            entries.push({ id: item.id, collectionId: group.id, title: item.text || '無標題',
                date: item.planDate, kind: getPlanKind(item), completed: Boolean(item.completed) });
        }
    }
    for (const anniversary of anniversaries) {
        const occurrence = anniversaryOccurrence(anniversary, year);
        const date = parseDateKey(occurrence);
        if (date?.month === month) entries.push({ id: anniversary.id, title: anniversary.title || '紀念日',
            date: occurrence, kind: 'anniversary', completed: false });
    }
    return entries.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, 'zh-Hant'));
}

export function getUpcomingAnniversaries(anniversaries, todayKey, daysAhead = 30) {
    const today = parseDateKey(todayKey);
    if (!today) return [];
    const todayTime = Date.UTC(today.year, today.month - 1, today.day);
    const limit = todayTime + daysAhead * 86400000;
    return anniversaries.flatMap(item => [today.year, today.year + 1]
        .map(year => ({ ...item, occurrence: anniversaryOccurrence(item, year) }))
        .filter(entry => {
            const parsed = parseDateKey(entry.occurrence);
            if (!parsed) return false;
            const time = Date.UTC(parsed.year, parsed.month - 1, parsed.day);
            return time >= todayTime && time <= limit;
        }))
        .sort((a, b) => a.occurrence.localeCompare(b.occurrence));
}
