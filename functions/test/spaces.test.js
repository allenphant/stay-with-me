"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  INVITE_TTL_MS,
  canAcceptInvite,
  getInviteExpiration,
  normalizeEmail,
  normalizeSpaceName,
} = require("../src/spaces");

test("normalizes invite email and rejects malformed addresses", () => {
  assert.equal(normalizeEmail(" Partner@Example.COM "), "partner@example.com");
  assert.equal(normalizeEmail("not-an-email"), "");
});

test("normalizes a short shared-space name", () => {
  assert.equal(normalizeSpaceName("  我們   的家  "), "我們 的家");
  assert.equal(normalizeSpaceName(""), "我們的空間");
});

test("invite acceptance requires matching email, pending status, and valid time", () => {
  const now = 1_000;
  const invite = {
    invitedEmail: "partner@example.com",
    status: "pending",
    expiresAt: now + 1,
  };
  assert.deepEqual(
    canAcceptInvite(invite, {email: "PARTNER@example.com"}, now),
    {allowed: true, reason: ""},
  );
  assert.equal(canAcceptInvite(invite, {email: "other@example.com"}, now).reason, "email_mismatch");
  assert.equal(canAcceptInvite({...invite, status: "accepted"}, {email: "partner@example.com"}, now).reason, "invite_not_pending");
  assert.equal(canAcceptInvite({...invite, expiresAt: now}, {email: "partner@example.com"}, now).reason, "invite_expired");
  assert.equal(getInviteExpiration(now), now + INVITE_TTL_MS);
});
