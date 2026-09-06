import { describe, expect, it } from "vitest";
import {
  authorizeAuthenticatedUser,
  normalizeEmail,
  readAiOwnerEmail,
} from "./auth-policy";

describe("AI owner authorization policy", () => {
  it("normalizes email addresses before comparison", () => {
    expect(normalizeEmail(" Owner@Example.COM ")).toBe("owner@example.com");
  });

  it("reports the missing server-only owner setting without its value", () => {
    expect(readAiOwnerEmail(" ")).toEqual({
      ok: false,
      missing: ["AI_OWNER_EMAIL"],
    });
  });

  it("allows every verified Google user into an authenticated session", () => {
    expect(
      authorizeAuthenticatedUser(
        {
          uid: "regular-user-uid",
          email: "member@example.com",
          email_verified: true,
        },
        "owner@example.com",
      ),
    ).toEqual({
      uid: "regular-user-uid",
      email: "member@example.com",
      canUseAi: false,
    });
  });

  it("grants AI access only to the configured owner email", () => {
    expect(
      authorizeAuthenticatedUser(
        {
          uid: "owner-uid",
          email: "OWNER@example.com",
          email_verified: true,
        },
        "owner@example.com",
      ),
    ).toEqual({
      uid: "owner-uid",
      email: "owner@example.com",
      canUseAi: true,
    });
  });

  it("rejects tokens without a uid or verified email", () => {
    expect(
      authorizeAuthenticatedUser(
        { uid: "uid", email: "member@example.com", email_verified: false },
        "owner@example.com",
      ),
    ).toBeNull();
    expect(
      authorizeAuthenticatedUser(
        { uid: "", email: "member@example.com", email_verified: true },
        "owner@example.com",
      ),
    ).toBeNull();
  });
});
