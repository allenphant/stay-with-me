"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  tokenLedgerPath,
  tokenWalletPath,
} = require("../src/couple-feature-paths");

function assertDocumentPath(path) {
  const segments = path.split("/").filter(Boolean);
  assert.equal(segments.length % 2, 0, `${path} must resolve to a Firestore document`);
}

test("couple-life token paths resolve to Firestore documents", () => {
  const wallet = tokenWalletPath("stay-with-me", "space-1", "user-1");
  const ledger = tokenLedgerPath("stay-with-me", "space-1", "entry-1");

  assert.equal(wallet, "artifacts/stay-with-me/users/space-1/tokenWallets/user-1");
  assert.equal(ledger, "artifacts/stay-with-me/users/space-1/tokenLedger/entry-1");
  assertDocumentPath(wallet);
  assertDocumentPath(ledger);
});
