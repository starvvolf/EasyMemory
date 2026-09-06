import { createHash, timingSafeEqual } from "node:crypto";

export const VSCODE_LINK_TTL_MS = 2 * 60 * 1000;
const EXTENSION_AUTHORITY = "study-forge-local.study-forge-vscode";
const EXTENSION_PATH = "/firebase-auth";
const BASE64URL = /^[A-Za-z0-9_-]+$/;

export class VscodeLinkRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VscodeLinkRequestError";
  }
}

export type VscodeLinkRequest = {
  callbackUri: string;
  state: string;
  challenge: string;
};

export type VscodeLinkExchange = {
  code: string;
  state: string;
  verifier: string;
};

export type StoredVscodeLink = {
  ownerUid: string;
  email: string;
  callbackUri: string;
  stateHash: string;
  challenge: string;
  createdAtMs: number;
  expiresAtMs: number;
};

export function validateVscodeLinkRequest(input: VscodeLinkRequest) {
  validateOpaqueValue(input.state, "연결 상태", 22, 128);
  validateOpaqueValue(input.challenge, "연결 challenge", 43, 43);
  const callback = new URL(input.callbackUri);
  if (
    !["vscode:", "vscode-insiders:"].includes(callback.protocol) ||
    callback.hostname !== EXTENSION_AUTHORITY ||
    callback.pathname !== EXTENSION_PATH ||
    callback.username ||
    callback.password ||
    callback.port ||
    callback.search ||
    callback.hash
  ) {
    throw new VscodeLinkRequestError("등록된 Study Forge VS Code callback만 사용할 수 있습니다.");
  }
  return callback;
}

export function validateVscodeLinkExchange(input: VscodeLinkExchange) {
  validateOpaqueValue(input.code, "연결 코드", 43, 128);
  validateOpaqueValue(input.state, "연결 상태", 22, 128);
  validateOpaqueValue(input.verifier, "연결 verifier", 43, 128);
}

export function sha256Base64Url(value: string) {
  return createHash("sha256").update(value).digest("base64url");
}

export function linkCodeDocumentId(code: string) {
  return sha256Base64Url(code);
}

export function assertVscodeLinkExchange(
  link: StoredVscodeLink,
  input: VscodeLinkExchange,
  nowMs: number,
) {
  validateVscodeLinkExchange(input);
  if (nowMs >= link.expiresAtMs) throw new VscodeLinkRequestError("VS Code 계정 연결 요청이 만료되었습니다.");
  if (!safeEqual(link.stateHash, sha256Base64Url(input.state))) {
    throw new VscodeLinkRequestError("VS Code 계정 연결 상태가 일치하지 않습니다.");
  }
  if (!safeEqual(link.challenge, sha256Base64Url(input.verifier))) {
    throw new VscodeLinkRequestError("VS Code 계정 연결 verifier가 일치하지 않습니다.");
  }
}

function validateOpaqueValue(value: string, label: string, min: number, max: number) {
  if (
    typeof value !== "string" ||
    value.length < min ||
    value.length > max ||
    !BASE64URL.test(value)
  ) {
    throw new VscodeLinkRequestError(`${label}가 올바르지 않습니다.`);
  }
}

function safeEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}
