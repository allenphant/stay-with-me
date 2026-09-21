import {
    addDoc,
    collection,
    deleteDoc,
    doc,
    getDoc,
    onSnapshot,
    serverTimestamp,
    updateDoc
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';

const TOKEN_POLICY = Object.freeze({
    welcomeGrant: 20,
    dailyAnswerReward: 5,
    dailyDiaryReward: 3,
    diaryCharactersPerToken: 20,
    diaryMinimumPrice: 3,
    diaryMaximumPrice: 30
});

const GUINEA_PIG_LOAD_TIMEOUT_MS = 12000;

export const GUINEA_PIG_FEEDS = Object.freeze([
    {id: 'hay', name: '高級牧草', cost: 3, hunger: 18, mood: 2, icon: 'fa-seedling', description: '每天都需要的安心主食。'},
    {id: 'vegetables', name: '小蔬菜盤', cost: 5, hunger: 10, mood: 8, icon: 'fa-carrot', description: '補充水分，也讓今天心情更好。'},
    {id: 'treat', name: '磨牙小點心', cost: 8, hunger: 5, mood: 15, icon: 'fa-cookie-bite', description: '偶爾來一點，開心值大提升。'}
]);

const DAILY_QUESTIONS = [
    '最近有哪一個小瞬間，讓你覺得和對方一起生活很幸福？',
    '如果今天晚上多出兩個小時，你最想和對方一起做什麼？',
    '你希望對方最近多知道你心裡的哪一件事？',
    '你們下一次約會，最想留下什麼樣的回憶？',
    '最近有什麼事情值得兩個人一起慶祝？',
    '用三個詞形容你心中的理想週末。',
    '你想和對方一起學會什麼新技能？'
];

function taipeiParts(date = new Date()) {
    return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Taipei',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(date).map(part => [part.type, part.value]));
}

function todayKey() {
    const parts = taipeiParts();
    return `${parts.year}-${parts.month}-${parts.day}`;
}

function weekKey(dateKey = todayKey()) {
    const date = new Date(`${dateKey}T12:00:00Z`);
    const mondayOffset = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - mondayOffset);
    return date.toISOString().slice(0, 10);
}

function recentDateKeys(days = 7) {
    const dates = [];
    const today = new Date(`${todayKey()}T12:00:00Z`);
    for (let offset = 0; offset < days; offset += 1) {
        const date = new Date(today);
        date.setUTCDate(today.getUTCDate() - offset);
        dates.push(date.toISOString().slice(0, 10));
    }
    return dates;
}

function questionForDate(dateKey) {
    const seed = String(dateKey || '').replaceAll('-', '').split('').reduce((total, digit) => total + Number(digit), 0);
    return DAILY_QUESTIONS[seed % DAILY_QUESTIONS.length];
}

function diaryPrice(characterCount) {
    return Math.min(
        TOKEN_POLICY.diaryMaximumPrice,
        Math.max(TOKEN_POLICY.diaryMinimumPrice, Math.ceil(Math.max(0, Number(characterCount) || 0) / TOKEN_POLICY.diaryCharactersPerToken))
    );
}

function displayDate(dateKey) {
    const date = new Date(`${dateKey}T12:00:00+08:00`);
    return Number.isNaN(date.getTime())
        ? dateKey
        : date.toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', month: 'long', day: 'numeric', weekday: 'short' });
}

function timestampValue(value) {
    if (!value) return 0;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value === 'number') return value;
    return 0;
}

function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

export function createCoupleFeatures({
    db,
    appId,
    cloudFunctions,
    httpsCallable,
    getCurrentUser = () => null,
    getMembers = () => [],
    getPlannerContext = () => ({}),
    openSettings = () => {},
    showToast = () => {}
} = {}) {
    const state = {
        spaceId: null,
        unsubs: [],
        wallet: null,
        question: null,
        answers: [],
        answerHistory: [],
        diaries: [],
        contentByDiary: new Map(),
        openDiaryId: null,
        whiteboardBlocks: [],
        weeklyReview: null,
        guineaPig: null,
        guineaPigLoading: false,
        guineaPigLoadError: '',
        busy: new Set()
    };

    const element = id => document.getElementById(id);
    const currentUser = () => getCurrentUser?.();
    const currentUid = () => currentUser()?.uid || '';
    const resolvedAppId = () => typeof appId === 'function' ? appId() : appId;
    const rootPath = () => ['artifacts', resolvedAppId(), 'users', state.spaceId];
    const call = (name, payload) => httpsCallable(cloudFunctions, name)(payload);
    const setBusy = (key, busy) => busy ? state.busy.add(key) : state.busy.delete(key);

    function withTimeout(promise, timeoutMs, timeoutMessage) {
        let timer;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
        });
        return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
    }

    function normalizeGuineaPig(pet) {
        if (!pet || typeof pet !== 'object') return null;
        const stat = (value, fallback) => {
            const number = Number(value);
            return Number.isFinite(number) ? Math.min(100, Math.max(0, number)) : fallback;
        };
        const inventory = Object.fromEntries(GUINEA_PIG_FEEDS.map(feed => [
            feed.id,
            Math.max(0, Number(pet.inventory?.[feed.id]) || 0)
        ]));
        return {
            ...pet,
            id: pet.id || 'guineaPig',
            name: pet.name || '小糰子',
            hunger: stat(pet.hunger, 72),
            mood: stat(pet.mood, 68),
            health: stat(pet.health, 100),
            feedCount: Math.max(0, Number(pet.feedCount) || 0),
            inventory
        };
    }

    function guineaPigErrorMessage(error) {
        const code = String(error?.code || '');
        if (error?.message?.includes('逾時')) return '連線逾時，請點「重新載入」再試一次。';
        if (code.includes('unauthenticated')) return '登入狀態已過期，請重新登入後再試。';
        if (code.includes('permission-denied')) return '共同空間權限尚未同步，請點「重新載入」再試一次。';
        return '小糰子目前無法載入，請點「重新載入」再試一次。';
    }

    function applyGuineaPig(pet) {
        const normalized = normalizeGuineaPig(pet);
        if (!normalized) return false;
        state.guineaPig = normalized;
        state.guineaPigLoadError = '';
        return true;
    }

    function setStatus(id, message, tone = 'muted') {
        const target = element(id);
        if (!target) return;
        target.textContent = message;
        target.dataset.tone = tone;
        target.classList.toggle('text-rose-700', tone === 'error');
        target.classList.toggle('text-emerald-700', tone === 'success');
        target.classList.toggle('text-slate-500', tone === 'muted');
    }

    function renderTokenBalance() {
        const wallet = state.wallet;
        const balance = Math.max(0, Number(wallet?.balance || 0));
        const balanceElement = element('couple-token-balance');
        if (balanceElement) balanceElement.textContent = `${balance}`;
        const status = element('couple-token-status');
        if (!currentUser()) {
            setStatus('couple-token-status', '登入後會建立你的個人代幣錢包。');
        } else if (!wallet) {
            setStatus('couple-token-status', '正在準備你的代幣錢包…');
        } else {
            setStatus('couple-token-status', `每日回答 +${TOKEN_POLICY.dailyAnswerReward}，寫日記 +${TOKEN_POLICY.dailyDiaryReward}；首次使用贈送 ${TOKEN_POLICY.welcomeGrant} 枚。`);
        }
        if (status) status.setAttribute('aria-live', 'polite');
    }

    function guineaPigFeed(feedId) {
        return GUINEA_PIG_FEEDS.find(feed => feed.id === feedId) || null;
    }

    function renderGuineaPigStat(barId, valueId, value) {
        const normalized = Math.min(100, Math.max(0, Number(value) || 0));
        const bar = element(barId);
        const valueElement = element(valueId);
        if (bar) {
            bar.style.width = `${normalized}%`;
            bar.parentElement?.setAttribute('aria-valuenow', `${normalized}`);
        }
        if (valueElement) valueElement.textContent = `${normalized}`;
    }

    function renderGuineaPig() {
        const pet = state.guineaPig;
        const name = element('guinea-pig-name');
        const cardName = element('guinea-pig-name-card');
        const careStatus = element('guinea-pig-care-status');
        const inventoryElement = element('guinea-pig-inventory');
        const shop = element('guinea-pig-shop');
        const status = element('guinea-pig-status');
        const retry = element('guinea-pig-retry');
        if (!name || !careStatus || !inventoryElement || !shop || !status) return;

        name.textContent = pet?.name || '小糰子';
        if (cardName) cardName.textContent = pet?.name || '小糰子';
        if (!currentUser()) {
            careStatus.textContent = '登入後就能和對方一起照顧牠。';
            status.textContent = '登入後會準備你們的共同小夥伴。';
        } else if (state.guineaPigLoadError) {
            careStatus.textContent = '小糰子載入失敗';
            status.textContent = state.guineaPigLoadError;
        } else if (!pet) {
            careStatus.textContent = state.guineaPigLoading ? '正在準備你們的共同小夥伴…' : '等待共同小夥伴資料…';
            status.textContent = state.guineaPigLoading ? '第一次進入時會自動領養小糰子。' : '請點「重新載入」再試一次。';
        } else {
            careStatus.textContent = `${pet.feedCount || 0} 次共同餵食 · 兩個人都可以照顧牠`;
            status.textContent = '用每日累積的代幣買飼料，再一起餵飽小糰子。';
        }
        if (retry) {
            retry.hidden = !currentUser() || !state.guineaPigLoadError;
            retry.disabled = state.guineaPigLoading;
            retry.textContent = state.guineaPigLoading ? '重新連線中…' : '重新載入';
        }
        renderGuineaPigStat('guinea-pig-hunger-bar', 'guinea-pig-hunger-value', pet?.hunger ?? 0);
        renderGuineaPigStat('guinea-pig-mood-bar', 'guinea-pig-mood-value', pet?.mood ?? 0);

        inventoryElement.replaceChildren();
        GUINEA_PIG_FEEDS.forEach(feed => {
            const item = createElement('span', 'rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-amber-900');
            item.textContent = `${feed.name} ${Number(pet?.inventory?.[feed.id] || 0)}`;
            inventoryElement.appendChild(item);
        });

        shop.replaceChildren();
        GUINEA_PIG_FEEDS.forEach(feed => {
            const card = createElement('article', 'rounded-xl border border-amber-100 bg-white p-3');
            const heading = createElement('div', 'flex items-start justify-between gap-2');
            const title = createElement('div', 'flex min-w-0 items-center gap-2');
            title.appendChild(createElement('span', 'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700', ''));
            title.querySelector('span').appendChild(createElement('i', `fas ${feed.icon}`, ''));
            title.appendChild(createElement('h4', 'truncate text-sm font-bold text-slate-800', feed.name));
            heading.appendChild(title);
            heading.appendChild(createElement('span', 'shrink-0 rounded-full bg-amber-50 px-2 py-1 text-xs font-bold text-amber-800', `${feed.cost} 枚`));
            card.appendChild(heading);
            card.appendChild(createElement('p', 'mt-2 min-h-10 text-xs leading-5 text-slate-500', feed.description));
            const actions = createElement('div', 'mt-3 flex flex-wrap gap-2');
            const buy = createElement('button', 'min-h-9 flex-1 rounded-lg bg-amber-500 px-3 py-2 text-xs font-bold text-white hover:bg-amber-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:cursor-not-allowed disabled:opacity-50', '購買');
            buy.type = 'button';
            buy.dataset.guineaPigBuy = feed.id;
            buy.disabled = !currentUser() || !pet || state.busy.has(`buy:${feed.id}`) || Number(state.wallet?.balance || 0) < feed.cost;
            buy.textContent = state.busy.has(`buy:${feed.id}`) ? '購買中…' : Number(state.wallet?.balance || 0) < feed.cost ? '代幣不足' : '購買';
            const feedButton = createElement('button', 'min-h-9 flex-1 rounded-lg border border-indigo-200 px-3 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-50', '餵食');
            feedButton.type = 'button';
            feedButton.dataset.guineaPigFeed = feed.id;
            const inventoryCount = Number(pet?.inventory?.[feed.id] || 0);
            feedButton.disabled = !currentUser() || !pet || inventoryCount < 1 || state.busy.has(`feed:${feed.id}`);
            feedButton.textContent = state.busy.has(`feed:${feed.id}`) ? '餵食中…' : inventoryCount ? `餵食 ×${inventoryCount}` : '尚無庫存';
            actions.append(buy, feedButton);
            card.appendChild(actions);
            shop.appendChild(card);
        });
    }

    function memberLabel(uid) {
        const member = getMembers?.().find(item => item.uid === uid);
        return member?.displayName || member?.email || (uid === currentUid() ? '我' : '對方');
    }

    function renderQuestion() {
        const prompt = element('daily-question-prompt');
        if (prompt) prompt.textContent = state.question?.prompt || questionForDate(todayKey());
        const input = element('daily-question-input');
        const ownAnswer = state.answers.find(answer => answer.uid === currentUid());
        if (input && document.activeElement !== input) input.value = ownAnswer?.answer || '';
        const submit = element('daily-question-submit');
        if (submit) {
            submit.disabled = !currentUser() || state.busy.has('question');
            submit.textContent = state.busy.has('question') ? '儲存中…' : ownAnswer ? '更新回答' : '送出回答';
        }
        const answerList = element('daily-question-answers');
        if (!answerList) return;
        answerList.replaceChildren();
        if (!currentUser()) {
            answerList.appendChild(createElement('p', 'text-sm text-slate-500', '登入後就能留下今天的回答。'));
            return;
        }
        const members = getMembers?.();
        const hasBothAnswers = members.length >= 2
            ? members.every(member => state.answers.some(answer => answer.uid === member.uid))
            : state.answers.length >= 2;
        if (!hasBothAnswers) {
            const own = state.answers.find(answer => answer.uid === currentUid());
            answerList.appendChild(createElement('p', 'text-xs leading-5 text-slate-500', own
                ? '你的回答已保存。等對方也回答後，彼此的答案會一起揭曉。'
                : '先寫下你的答案；兩個人都回答後，就能一起看到彼此的想法。'));
            return;
        }
        state.answers
            .slice()
            .sort((a, b) => (a.uid === currentUid() ? -1 : 1) - (b.uid === currentUid() ? -1 : 1))
            .forEach(answer => {
                const item = createElement('div', 'rounded-xl bg-white/80 px-3 py-2');
                item.appendChild(createElement('div', 'text-xs font-bold text-indigo-700', memberLabel(answer.uid)));
                item.appendChild(createElement('p', 'mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700', answer.answer));
                answerList.appendChild(item);
            });
    }

    function renderDiaryPrice() {
        const input = element('daily-diary-input');
        const count = input?.value.length || 0;
        const countElement = element('daily-diary-count');
        const priceElement = element('daily-diary-price');
        if (countElement) countElement.textContent = `${count}/2000`;
        if (priceElement) priceElement.textContent = `${diaryPrice(count)} 枚`;
    }

    async function hydrateReadableDiaryContents() {
        const uid = currentUid();
        const readable = state.diaries
            .filter(diary => diary.authorUid === uid || diary.unlockedByUids?.includes(uid))
            .slice(0, 30);
        await Promise.all(readable.map(async diary => {
            if (state.contentByDiary.has(diary.id)) return;
            try {
                const snapshot = await getDoc(doc(db, ...rootPath(), 'diaries', diary.id, 'content', 'private'));
                if (snapshot.exists()) state.contentByDiary.set(diary.id, snapshot.data().text || '');
            } catch (error) {
                console.error('預載入日記內容失敗', error);
            }
        }));
        renderDiaryList();
    }

    function renderDiaryList() {
        const list = element('daily-diary-list');
        if (!list) return;
        list.replaceChildren();
        if (!currentUser()) {
            list.appendChild(createElement('p', 'text-sm text-slate-500', '登入後會看到你們的日記。'));
            return;
        }
        if (state.diaries.length === 0) {
            list.appendChild(createElement('p', 'text-sm text-slate-500', '還沒有日記。今天留一句給未來的你們吧。'));
            return;
        }
        const uid = currentUid();
        state.diaries
            .slice()
            .sort((a, b) => String(b.dateKey).localeCompare(String(a.dateKey)))
            .forEach(diary => {
                const isAuthor = diary.authorUid === uid;
                const isUnlocked = isAuthor || diary.unlockedByUids?.includes(uid);
                const item = createElement('article', 'rounded-xl border border-slate-200 bg-white p-3');
                const header = createElement('div', 'flex flex-wrap items-start justify-between gap-2');
                const title = createElement('div');
                title.appendChild(createElement('h4', 'text-sm font-bold text-slate-800', displayDate(diary.dateKey)));
                title.appendChild(createElement('p', 'mt-1 text-xs text-slate-500', `${memberLabel(diary.authorUid)} · ${diary.charCount || 0} 字`));
                header.appendChild(title);
                const action = createElement('button', 'rounded-lg px-3 py-1.5 text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300');
                action.type = 'button';
                action.dataset.diaryAction = isUnlocked ? 'view' : 'unlock';
                action.dataset.diaryId = diary.id;
                if (isUnlocked) {
                    action.classList.add('bg-indigo-50', 'text-indigo-700', 'hover:bg-indigo-100');
                    action.textContent = state.openDiaryId === diary.id ? '收起' : '查看';
                } else {
                    action.classList.add('bg-rose-50', 'text-rose-700', 'hover:bg-rose-100');
                    action.textContent = `解鎖 · ${diary.price || diaryPrice(diary.charCount)} 枚`;
                }
                header.appendChild(action);
                item.appendChild(header);
                if (!isUnlocked) {
                    item.appendChild(createElement('p', 'mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500', '這篇日記還藏著。使用代幣解鎖後永久可讀。'));
                }
                if (state.openDiaryId === diary.id && isUnlocked) {
                    const content = state.contentByDiary.get(diary.id);
                    item.appendChild(createElement('p', 'mt-3 whitespace-pre-wrap rounded-lg bg-rose-50/60 px-3 py-3 text-sm leading-6 text-rose-950', content || '載入日記內容中…'));
                }
                list.appendChild(item);
            });
    }

    function renderWhiteboard() {
        const list = element('shared-whiteboard-list');
        if (!list) return;
        list.replaceChildren();
        if (!currentUser()) {
            list.appendChild(createElement('p', 'text-sm text-slate-500', '登入後可以和對方一起寫下想聊的話題。'));
            return;
        }
        if (state.whiteboardBlocks.length === 0) {
            list.appendChild(createElement('p', 'rounded-xl border border-dashed border-indigo-200 bg-indigo-50/40 px-3 py-4 text-sm text-indigo-800', '白板還是空的。先放一個「下次想聊…」或一起完成的小 Todo。'));
            return;
        }
        state.whiteboardBlocks
            .slice()
            .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
            .forEach(block => {
                const row = createElement('div', 'flex items-start gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2');
                if (block.type === 'todo') {
                    const checkbox = document.createElement('input');
                    checkbox.type = 'checkbox';
                    checkbox.checked = block.completed === true;
                    checkbox.className = 'mt-1.5 h-4 w-4 shrink-0 accent-indigo-600';
                    checkbox.setAttribute('aria-label', `完成 Todo：${block.content || ''}`);
                    checkbox.dataset.whiteboardToggle = block.id;
                    row.appendChild(checkbox);
                } else {
                    row.appendChild(createElement('span', 'mt-1.5 flex h-2 w-2 shrink-0 rounded-full bg-rose-400', ''));
                }
                const input = document.createElement('input');
                input.type = 'text';
                input.value = block.content || '';
                input.maxLength = 500;
                input.className = `min-w-0 flex-1 border-0 bg-transparent px-0 py-1 text-sm leading-6 text-slate-700 outline-none focus:ring-0 ${block.completed ? 'text-slate-400 line-through' : ''}`;
                input.setAttribute('aria-label', block.type === 'todo' ? '共同 Todo' : '共同筆記');
                input.dataset.whiteboardEdit = block.id;
                row.appendChild(input);
                const deleteButton = createElement('button', 'rounded-lg px-2 py-1 text-xs text-slate-600 hover:bg-rose-50 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300', '刪除');
                deleteButton.type = 'button';
                deleteButton.dataset.whiteboardDelete = block.id;
                deleteButton.setAttribute('aria-label', `刪除共同內容：${block.content || ''}`);
                row.appendChild(deleteButton);
                list.appendChild(row);
            });
    }

    function renderWeeklyReview() {
        const content = element('weekly-review-content');
        const weekElement = element('weekly-review-week');
        if (weekElement) weekElement.textContent = `本週（${displayDate(weekKey())} 起）`;
        if (!content) return;
        content.replaceChildren();
        if (state.weeklyReview?.content) {
            content.appendChild(createElement('div', 'whitespace-pre-wrap text-sm leading-7 text-slate-700', state.weeklyReview.content));
        } else {
            content.appendChild(createElement('p', 'text-sm leading-6 text-slate-500', currentUser()
                ? '還沒有這週的回顧。整理完共同生活的片段後，按下「生成本週回顧」。'
                : '登入後可以生成共同回顧。'));
        }
        const button = element('weekly-review-generate');
        if (button) {
            button.disabled = !currentUser() || state.busy.has('weeklyReview');
            button.textContent = state.busy.has('weeklyReview') ? '整理中…' : '生成本週回顧';
        }
    }

    function renderAll() {
        renderTokenBalance();
        renderGuineaPig();
        renderQuestion();
        renderDiaryPrice();
        renderDiaryList();
        renderWhiteboard();
        renderWeeklyReview();
    }

    function listen(target, onData, label, onError) {
        state.unsubs.push(onSnapshot(target, onData, error => {
            console.error(`共同生活功能${label}同步失敗`, error);
            if (onError) {
                onError(error);
                return;
            }
            setStatus('couple-life-status', `${label}同步失敗，請稍後重試。`, 'error');
        }));
    }

    async function ensureGuineaPig(spaceId) {
        if (!spaceId || !currentUser()) return;
        state.guineaPigLoading = true;
        state.guineaPigLoadError = '';
        renderGuineaPig();
        try {
            const result = await withTimeout(
                call('ensureGuineaPig', {spaceId}),
                GUINEA_PIG_LOAD_TIMEOUT_MS,
                '天竺鼠資料載入逾時'
            );
            const responsePet = result?.data?.pet || result?.data;
            if (!applyGuineaPig(responsePet)) throw new Error('共同小夥伴資料格式不正確');
        } catch (error) {
            console.error('建立天竺鼠失敗', error);
            if (!state.guineaPig) state.guineaPigLoadError = guineaPigErrorMessage(error);
        } finally {
            state.guineaPigLoading = false;
            renderGuineaPig();
        }
    }

    function retryGuineaPig() {
        if (state.guineaPigLoading) return;
        void ensureGuineaPig(state.spaceId);
    }

    function attachSpace(spaceId) {
        detach();
        state.spaceId = spaceId;
        if (!spaceId || !currentUser()) {
            renderAll();
            return;
        }
        const uid = currentUid();
        const root = rootPath();
        listen(doc(db, ...root, 'pets', 'guineaPig'), snapshot => {
            if (snapshot.exists()) {
                applyGuineaPig({id: snapshot.id, ...snapshot.data()});
                state.guineaPigLoading = false;
            } else if (!state.guineaPig) {
                state.guineaPig = null;
            }
            renderGuineaPig();
        }, '天竺鼠', error => {
            if (state.guineaPig) {
                setStatus('guinea-pig-status', '小糰子同步暫時中斷，但目前資料仍保留在畫面上。', 'error');
                return;
            }
            state.guineaPigLoading = false;
            state.guineaPigLoadError = guineaPigErrorMessage(error);
            renderGuineaPig();
        });
        void ensureGuineaPig(spaceId);
        listen(doc(db, ...root, 'tokenWallets', uid), snapshot => {
            state.wallet = snapshot.exists() ? snapshot.data() : null;
            renderTokenBalance();
            renderGuineaPig();
        }, '代幣');
        const questionDate = todayKey();
        listen(doc(db, ...root, 'dailyQuestions', questionDate), snapshot => {
            state.question = snapshot.exists() ? snapshot.data() : { prompt: questionForDate(questionDate) };
            renderQuestion();
        }, '每日問答');
        listen(collection(db, ...root, 'dailyQuestions', questionDate, 'answers'), snapshot => {
            state.answers = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
            renderQuestion();
        }, '每日回答');
        recentDateKeys().forEach(dateKey => {
            listen(collection(db, ...root, 'dailyQuestions', dateKey, 'answers'), snapshot => {
                const previous = state.answerHistory.filter(answer => answer.dateKey !== dateKey);
                state.answerHistory = previous.concat(snapshot.docs.map(item => ({
                    id: item.id,
                    dateKey,
                    ...item.data()
                })));
            }, '回答回顧');
        });
        listen(collection(db, ...root, 'diaries'), snapshot => {
            state.diaries = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
            renderDiaryList();
            void hydrateReadableDiaryContents();
        }, '日記');
        listen(collection(db, ...root, 'whiteboardBlocks'), snapshot => {
            state.whiteboardBlocks = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
            renderWhiteboard();
        }, '白板');
        listen(doc(db, ...root, 'weeklyReviews', weekKey()), snapshot => {
            state.weeklyReview = snapshot.exists() ? snapshot.data() : null;
            renderWeeklyReview();
        }, '每週回顧');
        call('ensureTokenWallet', { spaceId }).catch(error => {
            console.error('建立代幣錢包失敗', error);
            setStatus('couple-token-status', '代幣錢包尚未準備好，請稍後重試。', 'error');
        });
        renderAll();
    }

    function detach() {
        state.unsubs.forEach(unsubscribe => unsubscribe?.());
        state.unsubs = [];
        state.spaceId = null;
        state.wallet = null;
        state.question = null;
        state.answers = [];
        state.answerHistory = [];
        state.diaries = [];
        state.contentByDiary.clear();
        state.openDiaryId = null;
        state.whiteboardBlocks = [];
        state.weeklyReview = null;
        state.guineaPig = null;
        state.guineaPigLoading = false;
        state.guineaPigLoadError = '';
        state.busy.clear();
        renderAll();
    }

    async function submitDailyAnswer(event) {
        event.preventDefault();
        if (!currentUser() || !state.spaceId) return;
        const input = element('daily-question-input');
        const answer = input?.value.trim() || '';
        if (!answer) {
            setStatus('daily-question-status', '先寫下一點想法再送出。', 'error');
            input?.focus();
            return;
        }
        setBusy('question', true);
        renderQuestion();
        try {
            const result = await call('submitDailyAnswer', { spaceId: state.spaceId, dateKey: todayKey(), answer });
            setStatus('daily-question-status', result.data?.rewardGranted ? `回答已保存，獲得 +${TOKEN_POLICY.dailyAnswerReward} 枚代幣。` : '回答已更新。', 'success');
            showToast(result.data?.rewardGranted ? '每日回答完成，代幣已入帳。' : '每日回答已更新。', 'fas fa-comments');
        } catch (error) {
            console.error('儲存每日回答失敗', error);
            setStatus('daily-question-status', error?.message || '回答儲存失敗，請稍後再試。', 'error');
        } finally {
            setBusy('question', false);
            renderQuestion();
        }
    }

    async function saveDiary(event) {
        event.preventDefault();
        if (!currentUser() || !state.spaceId) return;
        const input = element('daily-diary-input');
        const dateInput = element('daily-diary-date');
        const text = input?.value.trim() || '';
        const dateKey = dateInput?.value || todayKey();
        if (!text) {
            setStatus('daily-diary-status', '先寫下一點今天的心情。', 'error');
            input?.focus();
            return;
        }
        setBusy('diary', true);
        const submit = element('daily-diary-submit');
        if (submit) submit.disabled = true;
        try {
            const result = await call('saveDailyDiary', { spaceId: state.spaceId, dateKey, text });
            setStatus('daily-diary-status', result.data?.rewardGranted ? `日記已保存，獲得 +${TOKEN_POLICY.dailyDiaryReward} 枚代幣。` : '日記已更新。', 'success');
            showToast('日記已保存。', 'fas fa-book-open');
        } catch (error) {
            console.error('儲存日記失敗', error);
            setStatus('daily-diary-status', error?.message || '日記儲存失敗，請稍後再試。', 'error');
        } finally {
            setBusy('diary', false);
            if (submit) submit.disabled = false;
            renderDiaryPrice();
        }
    }

    async function openDiary(diary) {
        if (state.openDiaryId === diary.id) {
            state.openDiaryId = null;
            renderDiaryList();
            return;
        }
        state.openDiaryId = diary.id;
        renderDiaryList();
        if (state.contentByDiary.has(diary.id)) return;
        try {
            const snapshot = await getDoc(doc(db, ...rootPath(), 'diaries', diary.id, 'content', 'private'));
            state.contentByDiary.set(diary.id, snapshot.exists() ? snapshot.data().text || '' : '這篇日記目前沒有內容。');
        } catch (error) {
            console.error('讀取日記內容失敗', error);
            state.contentByDiary.set(diary.id, '日記內容目前無法讀取，請稍後再試。');
        }
        renderDiaryList();
    }

    async function unlockDiary(diary) {
        setBusy(`unlock:${diary.id}`, true);
        renderDiaryList();
        try {
            const result = await call('unlockDailyDiary', { spaceId: state.spaceId, diaryId: diary.id });
            setStatus('daily-diary-status', `已解鎖，剩餘 ${result.data?.balance ?? '—'} 枚代幣。`, 'success');
            showToast('日記已解鎖，之後可以永久查看。', 'fas fa-unlock');
            await openDiary({...diary, unlockedByUids: [...(diary.unlockedByUids || []), currentUid()]});
        } catch (error) {
            console.error('解鎖日記失敗', error);
            setStatus('daily-diary-status', error?.message || '解鎖失敗，請稍後再試。', 'error');
        } finally {
            setBusy(`unlock:${diary.id}`, false);
            renderDiaryList();
        }
    }

    async function addWhiteboardBlock(event, type) {
        event.preventDefault();
        if (!currentUser() || !state.spaceId) return;
        const input = element(type === 'todo' ? 'shared-whiteboard-todo-input' : 'shared-whiteboard-note-input');
        const content = input?.value.trim() || '';
        if (!content) return;
        try {
            await addDoc(collection(db, ...rootPath(), 'whiteboardBlocks'), {
                type,
                content,
                completed: false,
                order: Date.now(),
                createdByUid: currentUid(),
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });
            input.value = '';
            setStatus('shared-whiteboard-status', '已加入共同白板。', 'success');
        } catch (error) {
            console.error('新增白板內容失敗', error);
            setStatus('shared-whiteboard-status', '白板新增失敗，請稍後再試。', 'error');
        }
    }

    async function editWhiteboardBlock(blockId, content) {
        const block = state.whiteboardBlocks.find(item => item.id === blockId);
        if (!block || !content.trim()) return;
        try {
            await updateDoc(doc(db, ...rootPath(), 'whiteboardBlocks', blockId), { content: content.trim().slice(0, 500), updatedAt: serverTimestamp() });
        } catch (error) {
            console.error('更新白板內容失敗', error);
            setStatus('shared-whiteboard-status', '白板更新失敗，請稍後再試。', 'error');
        }
    }

    async function toggleWhiteboardBlock(blockId, completed) {
        try {
            await updateDoc(doc(db, ...rootPath(), 'whiteboardBlocks', blockId), { completed, updatedAt: serverTimestamp() });
        } catch (error) {
            console.error('更新白板 Todo 失敗', error);
            setStatus('shared-whiteboard-status', 'Todo 更新失敗，請稍後再試。', 'error');
        }
    }

    async function removeWhiteboardBlock(blockId) {
        try {
            await deleteDoc(doc(db, ...rootPath(), 'whiteboardBlocks', blockId));
        } catch (error) {
            console.error('刪除白板內容失敗', error);
            setStatus('shared-whiteboard-status', '白板刪除失敗，請稍後再試。', 'error');
        }
    }

    function createPurchaseId() {
        return globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    }

    async function buyGuineaPigFeed(feedId) {
        const feed = guineaPigFeed(feedId);
        if (!feed || !currentUser() || !state.spaceId || state.busy.has(`buy:${feedId}`)) return;
        setBusy(`buy:${feedId}`, true);
        renderGuineaPig();
        try {
            const result = await call('buyGuineaPigFeed', {
                spaceId: state.spaceId,
                feedId,
                purchaseId: createPurchaseId()
            });
            if (result.data?.pet) applyGuineaPig(result.data.pet);
            setStatus('guinea-pig-status', `${feed.name} 已放進共同庫存，剩餘 ${result.data?.balance ?? '—'} 枚代幣。`, 'success');
            showToast(`${feed.name} 購買完成。`, 'fas fa-bag-shopping');
        } catch (error) {
            console.error('購買天竺鼠飼料失敗', error);
            setStatus('guinea-pig-status', error?.message || '購買失敗，請稍後再試。', 'error');
        } finally {
            setBusy(`buy:${feedId}`, false);
            renderGuineaPig();
        }
    }

    async function feedGuineaPig(feedId) {
        const feed = guineaPigFeed(feedId);
        if (!feed || !currentUser() || !state.spaceId || state.busy.has(`feed:${feedId}`)) return;
        setBusy(`feed:${feedId}`, true);
        renderGuineaPig();
        try {
            const result = await call('feedGuineaPig', {spaceId: state.spaceId, feedId});
            if (result.data?.pet) applyGuineaPig(result.data.pet);
            setStatus('guinea-pig-status', `小糰子吃了${feed.name}，飽足度 ${result.data?.hunger ?? '—'}、心情 ${result.data?.mood ?? '—'}。`, 'success');
            showToast('小糰子吃飽了。', 'fas fa-heart');
        } catch (error) {
            console.error('餵食天竺鼠失敗', error);
            setStatus('guinea-pig-status', error?.message || '餵食失敗，請稍後再試。', 'error');
        } finally {
            setBusy(`feed:${feedId}`, false);
            renderGuineaPig();
        }
    }

    function buildWeeklyReviewPrompt() {
        const context = getPlannerContext?.() || {};
        const visibleDiaries = state.diaries.map(diary => ({
            dateKey: diary.dateKey,
            authorUid: diary.authorUid,
            charCount: diary.charCount,
            text: state.contentByDiary.get(diary.id) || (diary.authorUid === currentUid() ? '[自己的日記尚未載入]' : '[對方日記尚未解鎖]')
        }));
        return `你是「Stay With Me」的共同生活回顧助手。請用溫柔、具體、繁體中文整理這對伴侶最近一週的共同生活。
只可以根據提供的資料，不要捏造事件；若資料不足就明確說資料不足。請輸出四個短段落，標題依序為：這週的亮點、我們正在累積的事、可以一起聊聊、下週的一個小提案。不要使用表格，不要評論任何一方對錯。

本週起始日：${weekKey()}
每日共同問答：
${JSON.stringify(state.answerHistory.map(answer => ({ dateKey: answer.dateKey, uid: answer.uid, answer: answer.answer })), null, 2)}
日記（只有已可讀內容會放入全文）：
${JSON.stringify(visibleDiaries, null, 2)}
共享白板：
${JSON.stringify(state.whiteboardBlocks.map(block => ({ type: block.type, content: block.content, completed: block.completed })), null, 2)}
共同計畫快照：
${JSON.stringify(context, null, 2)}`;
    }

    async function generateWeeklyReview() {
        if (!currentUser() || !state.spaceId) return;
        const apiKey = localStorage.getItem('geminiApiKey')?.trim();
        if (!apiKey) {
            setStatus('weekly-review-status', '請先到「設定 → AI 與研讀」儲存 Gemini API Key。', 'error');
            openSettings('ai');
            return;
        }
        setBusy('weeklyReview', true);
        renderWeeklyReview();
        setStatus('weekly-review-status', '正在整理最近一週的共同片段…');
        try {
            const model = localStorage.getItem('geminiModel') || 'gemini-2.5-flash';
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    contents: [{parts: [{text: buildWeeklyReviewPrompt()}]}],
                    generationConfig: {temperature: 0.45, maxOutputTokens: 900}
                })
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload?.error?.message || 'Gemini 回顧生成失敗。');
            const content = payload?.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('').trim();
            if (!content) throw new Error('Gemini 沒有回傳可用的回顧內容。');
            await call('saveWeeklyReview', {spaceId: state.spaceId, weekKey: weekKey(), content});
            setStatus('weekly-review-status', '本週回顧已保存到共同空間。', 'success');
            showToast('本週回顧完成。', 'fas fa-sparkles');
        } catch (error) {
            console.error('生成每週回顧失敗', error);
            setStatus('weekly-review-status', error?.message || '回顧生成失敗，請稍後再試。', 'error');
        } finally {
            setBusy('weeklyReview', false);
            renderWeeklyReview();
        }
    }

    function wireUi() {
        element('daily-question-form')?.addEventListener('submit', submitDailyAnswer);
        element('daily-diary-form')?.addEventListener('submit', saveDiary);
        element('daily-diary-input')?.addEventListener('input', renderDiaryPrice);
        element('shared-whiteboard-note-form')?.addEventListener('submit', event => addWhiteboardBlock(event, 'note'));
        element('shared-whiteboard-todo-form')?.addEventListener('submit', event => addWhiteboardBlock(event, 'todo'));
        element('weekly-review-generate')?.addEventListener('click', generateWeeklyReview);
        element('guinea-pig-retry')?.addEventListener('click', retryGuineaPig);
        element('guinea-pig-shop')?.addEventListener('click', event => {
            const buyButton = event.target.closest('[data-guinea-pig-buy]');
            if (buyButton) {
                void buyGuineaPigFeed(buyButton.dataset.guineaPigBuy);
                return;
            }
            const feedButton = event.target.closest('[data-guinea-pig-feed]');
            if (feedButton) void feedGuineaPig(feedButton.dataset.guineaPigFeed);
        });
        element('daily-diary-list')?.addEventListener('click', event => {
            const button = event.target.closest('[data-diary-action]');
            if (!button) return;
            const diary = state.diaries.find(item => item.id === button.dataset.diaryId);
            if (!diary || state.busy.has(`unlock:${diary.id}`)) return;
            if (button.dataset.diaryAction === 'view') void openDiary(diary);
            else void unlockDiary(diary);
        });
        element('shared-whiteboard-list')?.addEventListener('change', event => {
            const editId = event.target.dataset.whiteboardEdit;
            const toggleId = event.target.dataset.whiteboardToggle;
            if (editId) void editWhiteboardBlock(editId, event.target.value);
            if (toggleId) void toggleWhiteboardBlock(toggleId, event.target.checked);
        });
        element('shared-whiteboard-list')?.addEventListener('click', event => {
            const button = event.target.closest('[data-whiteboard-delete]');
            if (button) void removeWhiteboardBlock(button.dataset.whiteboardDelete);
        });
        const dateInput = element('daily-diary-date');
        if (dateInput && !dateInput.value) dateInput.value = todayKey();
    }

    wireUi();
    renderAll();
    return {attachSpace, detach, render: renderAll};
}
