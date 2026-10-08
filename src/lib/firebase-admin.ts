import "server-only";

import { getApp, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

function getProjectId(): string {
  const projectId =
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??
    process.env.GOOGLE_CLOUD_PROJECT;

  if (!projectId) {
    throw new Error(
      "Firebase 서버 설정이 없습니다. NEXT_PUBLIC_FIREBASE_PROJECT_ID 환경 변수를 설정하세요.",
    );
  }

  return projectId;
}

export function getFirebaseAdminAuth() {
  const app =
    getApps().length > 0
      ? getApp()
      : initializeApp({ projectId: getProjectId() });
  return getAuth(app);
}

export function getFirebaseAdminServices() {
  const app =
    getApps().length > 0
      ? getApp()
      : initializeApp({
          projectId: getProjectId(),
          storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
        });
  return {
    auth: getAuth(app),
    firestore: getFirestore(app),
    storage: getStorage(app),
  };
}
