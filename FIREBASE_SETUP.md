# Study Forge Firebase setup

This change prepares authentication and Firebase App Hosting, but it does not create
or deploy a Firebase project. Those operations require the owner's Google/Firebase
account.

## Current data boundary

- Google-authenticated users can open the app.
- The server returns the authenticated Firebase `uid` so a future Firestore/Storage
  layer can partition records by UID.
- Only the email in the server-only `AI_OWNER_EMAIL` variable can call `/api/*` AI
  routes. Other signed-in users can still use existing local decks and study flows.
- Decks remain in the browser IndexedDB database `memory-transformer`, object store
  `decks`. They are not synchronized, migrated, or currently partitioned by UID.
- No Firestore or Cloud Storage resources or security rules are added in this change.

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
3. Confirm a new Google account signs in automatically and can open the app, deck
   list, and study screen.
4. With a non-owner Google account, confirm the yellow permission notice is visible,
   AI action buttons are disabled, and a direct authenticated request to an AI API
   returns HTTP 403.
5. With the `AI_OWNER_EMAIL` account, confirm PDF analysis/generation can call the
   existing API routes.
6. Remove one Firebase variable and restart the dev server. The login screen must
   name the missing variable without displaying any configured values.
7. Remove `AI_OWNER_EMAIL` and make an authenticated API request. It must return HTTP
   500 naming only the missing variable.
8. Sign out and confirm the app content is hidden behind the Google login screen.

## Next phase (not included)

Introduce Firestore and Cloud Storage together with rules that require
`request.auth.uid == resource.data.ownerUid` (and equivalent create checks), then
design an explicit, reversible IndexedDB import. The current UID-bearing session is
the handoff point; this change intentionally does not alter deck IDs, records, or the
MCP data model.
