import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const readSources = () => Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../app.js', import.meta.url), 'utf8'),
    readFile(new URL('../functions/src/index.js', import.meta.url), 'utf8')
]);

test('cloud approval mode is accessible in settings and sent to the backend', async () => {
    const [html, appSource] = await readSources();
    assert.match(html, /name="cloud-research-approval-mode" value="manual"/);
    assert.match(html, /name="cloud-research-approval-mode" value="auto"/);
    assert.match(html, /<fieldset/);
    assert.match(html, /自動寫入只適用一般網址/);
    assert.match(appSource, /cloudResearchApprovalMode/);
    assert.match(appSource, /buildCloudAutomationPayload\(interval, \{ approvalMode \}\)/);
    assert.doesNotMatch(appSource, /buildCloudAutomationPayload\(interval, \{ approvalMode: 'manual' \}\)/);
});

test('jobs snapshot approval mode and retry auto writes without another model call', async () => {
    const [, , functionsSource] = await readSources();
    assert.match(functionsSource, /approvalMode: settings\.approvalMode/);
    assert.match(functionsSource, /status: autoApprove \? "auto_approving" : "pending_review"/);
    assert.match(functionsSource, /job\.status === "auto_approving"[\s\S]+autoApproveResearchJob\(jobRef\);[\s\S]+return;/);
    assert.match(functionsSource, /sourceFingerprint\(cardSnapshot\.data\(\)\) !== job\.sourceFingerprint/);
    assert.match(functionsSource, /reviewDecision: "auto_approved"/);
    assert.match(functionsSource, /Do not write the job back[\s\S]+lost commit acknowledgement/);
    assert.doesNotMatch(functionsSource, /status: "auto_approving",\s+error: \{\s+code: "auto_approval_retryable"/);
});
