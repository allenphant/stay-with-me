import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const readSources = () => Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../app.js', import.meta.url), 'utf8'),
    readFile(new URL('../firestore.rules', import.meta.url), 'utf8'),
    readFile(new URL('../functions/src/index.js', import.meta.url), 'utf8')
]);

test('shared-space UI supports switching, inviting, joining, and member removal', async () => {
    const [html, appSource] = await readSources();
    assert.match(html, /id="space-select"/);
    assert.match(html, /id="space-invite-email"/);
    assert.match(html, /id="space-invite-code"/);
    assert.match(html, /id="space-member-list"/);
    assert.match(appSource, /ensurePersonalSpaceCallable/);
    assert.match(appSource, /createSpaceInviteCallable/);
    assert.match(appSource, /acceptSpaceInviteCallable/);
    assert.match(appSource, /removeSpaceMemberCallable/);
    assert.match(appSource, /function getActiveSpaceId/);
});

test('Firestore rules deny invite access and authorize shared data through membership', async () => {
    const [, , rules] = await readSources();
    assert.match(rules, /function isSpaceMember/);
    assert.match(rules, /spaces\/\$\(spaceId\)\/members\/\$\(request\.auth\.uid\)/);
    assert.match(rules, /match \/artifacts\/\{appId\}\/spaceInvites\/\{inviteId\}/);
    assert.match(rules, /allow read, write: if false/);
    assert.doesNotMatch(rules, /allow read, write: if request\.auth != null;/);
});

test('Callable Functions enforce authenticated membership and invited email', async () => {
    const [, , , functionsSource] = await readSources();
    assert.match(functionsSource, /exports\.ensurePersonalSpace/);
    assert.match(functionsSource, /exports\.createSpaceInvite/);
    assert.match(functionsSource, /exports\.acceptSpaceInvite/);
    assert.match(functionsSource, /exports\.removeSpaceMember/);
    assert.match(functionsSource, /requireSpaceMember\(spaceId, uid\)/);
    assert.match(functionsSource, /canAcceptInvite\(inviteSnapshot\.data\(\), \{email\}\)/);
});
