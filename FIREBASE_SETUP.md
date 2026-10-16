# Study Forge Firebase setup

This change prepares authentication and Firebase App Hosting, but it does not create
or deploy a Firebase project. Those operations require the owner's Google/Firebase
account.

## Current data boundary (integration update: 2026-09-22)

- Google authentication and server-side owner-only AI authorization remain in place.
- Account-scoped Firestore/Storage adapters now cover projects, source PDFs, decks, study sessions, review state, reading positions, and learner memory. See [the data model](docs/FIREBASE_DATA_MODEL.md) and [memory contract](docs/LEARNER_MEMORY_CONTRACT.md).
- Firestore and Storage rules are included. Their presence does not mean they have been deployed.
- Local browser/filesystem data remains local until explicitly imported. Cloning this repository does not transfer it.
- Local coding/model-management routes still have narrower owner/local-host boundaries; cloud persistence is not proof that every local tool works remotely.
- This integration was built and tested offline. Real account login, cloud synchronization and deployed rules were not reverified.

## Firebase console checklist

1. Create or select a Firebase project on the Blaze plan (App Hosting requires a
   billing account).
2. In **Project settings > Your apps**, add a Web app. Copy its Web SDK configuration.
3. In **Authentication > Sign-in method**, enable only the Google provider needed by
   this app and select the project's support email. Do not enable email/password.
4. In **Authentication > Settings > Authorized domains**, include every domain used
   for login: the App Hosting domain, any custom production domain, and `localhost`
   for local development.
5. In **App Hosting**, create a backend linked to this repository and the deployment
   branch. Select the repository root as the app root. `apphosting.yaml` supplies the
   minimal runtime sizing configuration.
6. In **App Hosting > Backend > Settings > Environment**, add the variables below.
   Trigger a new rollout after saving them.

## Required environment variables

Use `.env.local` for local development (it is gitignored) and App Hosting's
environment settings for deployment. `.env.example` contains names only.

| Variable | Availability | Source |
| --- | --- | --- |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Build and runtime | Web SDK config |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Build and runtime | Web SDK config |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Build and runtime | Web SDK config |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Build and runtime | Web SDK config |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Build and runtime | Web SDK config (optional for current Auth flow) |
| `AI_OWNER_EMAIL` | Runtime only | Exact Google email allowed to use AI routes |
| `OPENAI_API_KEY` | Runtime only, secret | Existing OpenAI API secret |
| `OPENAI_MODEL` | Runtime only | Existing optional model override |

`AI_OWNER_EMAIL` must never be renamed with a `NEXT_PUBLIC_` prefix. The API checks
it on the server. Firebase Web SDK configuration values identify the Firebase app;
they are not authorization secrets.

Store `OPENAI_API_KEY` in Google Cloud Secret Manager and grant the App Hosting
backend access through the App Hosting environment settings. Do not paste its value
into `apphosting.yaml` or commit it to an env file.

## Local verification

1. Copy `.env.example` to `.env.local` and fill the Firebase Web app values,
   `AI_OWNER_EMAIL`, and the existing OpenAI settings.
2. Run `npm run dev` and open `http://localhost:3000`.
3. Confirm a new Google account is created by Google sign-in and can open the app,
   browser-local deck list, and study screen. Confirm the account chip says either
   `운영자` or `일반 회원`.
4. With a non-owner Google account, confirm the yellow permission notice is visible,
   and a direct authenticated request to an AI API returns HTTP 403. Account-scoped project/source APIs must expose only that UID’s data; owner-only
   local management routes must still return HTTP 403.
5. With the `AI_OWNER_EMAIL` account, confirm PDF analysis/generation can call the
   existing API routes.
6. Remove one Firebase variable and restart the dev server. The login screen must
   name the missing variable without displaying any configured values.
7. Remove `AI_OWNER_EMAIL` and make an authenticated API request. It must return HTTP
   500 naming only the missing variable.
8. Sign out and confirm the app content is hidden behind the Google login screen.

## Deployment and data migration still require verification

Firestore/Storage adapters, rules and explicit import endpoints are included in this branch. See [the data model](docs/FIREBASE_DATA_MODEL.md). Configure the actual Firebase resources and verify deployed rules with separate user accounts before relying on cloud storage. Existing IndexedDB/host files are not transferred by Git and must not be silently assigned to the first signed-in account. This integration did not deploy resources or migrate personal data.
