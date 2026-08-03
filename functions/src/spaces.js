"use strict";

const crypto = require("node:crypto");

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return "";
  }
  return email;
}

function normalizeSpaceName(value, fallback = "我們的空間") {
  const name = String(value || "").trim().replace(/\s+/g, " ").slice(0, 40);
  return name || fallback;
}

function createInviteCode() {
  return crypto.randomBytes(18).toString("base64url");
}

function getInviteExpiration(now = Date.now()) {
  return now + INVITE_TTL_MS;
}

function canAcceptInvite(invite = {}, user = {}, now = Date.now()) {
  const invitedEmail = normalizeEmail(invite.invitedEmail);
  const userEmail = normalizeEmail(user.email);
  if (!invitedEmail || !userEmail || invitedEmail !== userEmail) {
    return {allowed: false, reason: "email_mismatch"};
  }
  if (invite.status !== "pending") {
    return {allowed: false, reason: "invite_not_pending"};
  }
  if (Number(invite.expiresAt || 0) <= now) {
    return {allowed: false, reason: "invite_expired"};
  }
  return {allowed: true, reason: ""};
}

module.exports = {
  INVITE_TTL_MS,
  canAcceptInvite,
  createInviteCode,
  getInviteExpiration,
  normalizeEmail,
  normalizeSpaceName,
};
