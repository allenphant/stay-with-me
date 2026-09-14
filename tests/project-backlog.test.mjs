import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const todo = readFileSync(new URL('../TODO.md', import.meta.url), 'utf8');

test('product backlog keeps the current work, product backlog, and completed work separated', () => {
    assert.match(todo, /^# Stay With Me 待辦清單/m);
    assert.match(todo, /^## 現在處理：/m);
    assert.match(todo, /^## 產品功能待辦/m);
    assert.match(todo, /^## 已完成/m);
    assert.match(todo, /每日小日記/);
});
