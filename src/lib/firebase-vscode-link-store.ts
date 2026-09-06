import { randomBytes } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import {
  assertVscodeLinkExchange,
  linkCodeDocumentId,
  sha256Base64Url,
  validateVscodeLinkRequest,
  VSCODE_LINK_TTL_MS,
  type StoredVscodeLink,
  type VscodeLinkExchange,
  type VscodeLinkRequest,
  VscodeLinkRequestError,
} from "./vscode-link-contract.ts";

const LINK_COLLECTION = "vscodeLinkCodes";

export async function createVscodeLinkCode(
  firestore: Firestore,
  user: { uid: string; email: string },
  input: VscodeLinkRequest,
  nowMs = Date.now(),
) {
  const callback = validateVscodeLinkRequest(input);
  const code = randomBytes(32).toString("base64url");
  const link: StoredVscodeLink = {
    ownerUid: user.uid,
    email: user.email,
    stateHash: sha256Base64Url(input.state),
    challenge: input.challenge,
    createdAtMs: nowMs,
    expiresAtMs: nowMs + VSCODE_LINK_TTL_MS,
  };
  await firestore.collection(LINK_COLLECTION).doc(linkCodeDocumentId(code)).create(link);
  callback.searchParams.set("code", code);
  callback.searchParams.set("state", input.state);
  return { callbackUri: callback.toString(), expiresAt: new Date(link.expiresAtMs).toISOString() };
}

export async function consumeVscodeLinkCode(
  firestore: Firestore,
  input: VscodeLinkExchange,
  nowMs = Date.now(),
) {
  const reference = firestore.collection(LINK_COLLECTION).doc(linkCodeDocumentId(input.code));
  const result = await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) throw new VscodeLinkRequestError("VS Code 계정 연결 요청을 찾지 못했거나 이미 사용했습니다.");
    const link = snapshot.data() as StoredVscodeLink;
    assertVscodeLinkExchange(link, input, nowMs);
    transaction.delete(reference);
    return { uid: link.ownerUid, email: link.email };
  });
  return result;
}

export async function cancelVscodeLinkCode(
  firestore: Firestore,
  input: VscodeLinkExchange,
  nowMs = Date.now(),
) {
  const reference = firestore.collection(LINK_COLLECTION).doc(linkCodeDocumentId(input.code));
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) return false;
    assertVscodeLinkExchange(snapshot.data() as StoredVscodeLink, input, nowMs);
    transaction.delete(reference);
    return true;
  });
}
