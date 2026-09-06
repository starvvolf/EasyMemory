import { readFile } from "node:fs/promises";
import test, { after, before } from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { getBytes, ref, uploadBytes } from "firebase/storage";

let environment;

before(async () => {
  environment = await initializeTestEnvironment({
    projectId: "study-forge-rules-test",
    firestore: { rules: await readFile("firestore.rules", "utf8") },
    storage: { rules: await readFile("storage.rules", "utf8") },
  });
});

after(async () => {
  await environment?.cleanup();
});

test("Firestore는 자기 UID 문서만 읽고 쓸 수 있다", async () => {
  const alice = environment.authenticatedContext("alice");
  const bob = environment.authenticatedContext("bob");
  const aliceDeck = doc(alice.firestore(), "users/alice/decks/deck-1");

  await assertSucceeds(setDoc(aliceDeck, { ownerUid: "alice", title: "mine" }));
  await assertSucceeds(getDoc(aliceDeck));
  await assertFails(getDoc(doc(bob.firestore(), "users/alice/decks/deck-1")));
  await assertFails(
    setDoc(doc(bob.firestore(), "users/alice/decks/deck-2"), {
      ownerUid: "bob",
      title: "cross-account",
    }),
  );
  await assertFails(
    setDoc(doc(alice.firestore(), "users/alice/decks/deck-2"), {
      ownerUid: "bob",
      title: "forged-owner",
    }),
  );
});

test("Firestore 미로그인 접근과 사용자 경로 밖 접근을 거부한다", async () => {
  const guest = environment.unauthenticatedContext();
  const alice = environment.authenticatedContext("alice");
  await assertFails(getDoc(doc(guest.firestore(), "users/alice/decks/deck-1")));
  await assertFails(
    setDoc(doc(alice.firestore(), "public/deck-1"), {
      ownerUid: "alice",
    }),
  );
});

test("Storage는 자기 UID 원본만 읽고 쓸 수 있다", async () => {
  const alice = environment.authenticatedContext("alice");
  const bob = environment.authenticatedContext("bob");
  const aliceFile = ref(
    alice.storage(),
    "users/alice/sources/source-1/original/source.pdf",
  );
  await assertSucceeds(
    uploadBytes(aliceFile, new Uint8Array([1, 2, 3]), {
      contentType: "application/pdf",
    }),
  );
  await assertSucceeds(getBytes(aliceFile));
  await assertFails(
    getBytes(
      ref(bob.storage(), "users/alice/sources/source-1/original/source.pdf"),
    ),
  );
  await assertFails(
    uploadBytes(
      ref(bob.storage(), "users/alice/sources/source-2/original/source.pdf"),
      new Uint8Array([4]),
    ),
  );
});
