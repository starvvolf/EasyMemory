import assert from "node:assert/strict";
import test from "node:test";
import {
  authorizeAuthenticatedUser,
  getApiAccessLevel,
  normalizeEmail,
  readAiOwnerEmail,
} from "../src/lib/auth-policy.ts";

test("normalizes email addresses before comparison", () => {
  assert.equal(normalizeEmail(" Owner@Example.COM "), "owner@example.com");
});

test("reports a missing owner setting without exposing a value", () => {
  assert.deepEqual(readAiOwnerEmail(" "), {
    ok: false,
    missing: ["AI_OWNER_EMAIL"],
  });
});

test("allows a verified Google member without AI permission", () => {
  assert.deepEqual(
    authorizeAuthenticatedUser(
      {
        uid: "member-uid",
        email: "member@example.com",
        email_verified: true,
        firebase: { sign_in_provider: "google.com" },
      },
      "owner@example.com",
    ),
    {
      uid: "member-uid",
      email: "member@example.com",
      canUseAi: false,
    },
  );
});

test("grants AI permission only to the configured owner", () => {
  assert.deepEqual(
    authorizeAuthenticatedUser(
      {
        uid: "owner-uid",
        email: "OWNER@example.com",
        email_verified: true,
        firebase: { sign_in_provider: "google.com" },
      },
      "owner@example.com",
    ),
    {
      uid: "owner-uid",
      email: "owner@example.com",
      canUseAi: true,
    },
  );
});

test("rejects unverified email and non-Google provider tokens", () => {
  assert.equal(
    authorizeAuthenticatedUser(
      {
        uid: "uid",
        email: "member@example.com",
        email_verified: false,
        firebase: { sign_in_provider: "google.com" },
      },
      "owner@example.com",
    ),
    null,
  );
  assert.equal(
    authorizeAuthenticatedUser(
      {
        uid: "uid",
        email: "member@example.com",
        email_verified: true,
        firebase: { sign_in_provider: "password" },
      },
      "owner@example.com",
    ),
    null,
  );
});

test("separates AI, shared host-data, and member API access", () => {
  assert.equal(getApiAccessLevel("/api/generate"), "owner-ai");
  assert.equal(getApiAccessLevel("/api/codex/chat"), "owner-ai");
  assert.equal(
    getApiAccessLevel("/api/study-projects/project-1"),
    "owner-local-data",
  );
  assert.equal(getApiAccessLevel("/api/mcp-decks"), "owner-local-data");
  assert.equal(getApiAccessLevel("/api/auth/session"), "member");
  assert.equal(getApiAccessLevel("/api/future-study-tool"), "member");
});
