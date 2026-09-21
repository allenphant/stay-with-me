"use strict";

function coupleSpacePath(appId, spaceId) {
  return `artifacts/${appId}/users/${spaceId}`;
}

function tokenWalletPath(appId, spaceId, uid) {
  return `${coupleSpacePath(appId, spaceId)}/tokenWallets/${uid}`;
}

function tokenLedgerPath(appId, spaceId, ledgerId) {
  return `${coupleSpacePath(appId, spaceId)}/tokenLedger/${ledgerId}`;
}

module.exports = {
  coupleSpacePath,
  tokenLedgerPath,
  tokenWalletPath,
};
