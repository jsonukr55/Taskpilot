# Deploying TaskPilot to Firebase

Complete, repeatable steps to publish TaskPilot. Tailored to this project:

- **Firebase project id:** `taskpilot-ad725`
- **Hosting build output:** `dist/taskpilot/browser` (what `firebase.json` serves)
- **Cloud Functions:** `functions/`
- **Live URLs:** https://taskpilot-ad725.web.app and https://taskpilot-ad725.firebaseapp.com

---

## 0. One-time setup

```bash
# Install the Firebase CLI (once, globally)
npm install -g firebase-tools

# Log in to the Google account that owns the Firebase project
firebase login
```

Two prerequisites for this project:

1. **Blaze (pay-as-you-go) plan** — required to deploy Cloud Functions. The free
   Spark plan cannot deploy functions.
2. **`functions/.env`** must exist with the Groq API key. This file is
   **git-ignored** (so a fresh clone won't have it) — recreate it:

   ```
   GROQ_API_KEY=gsk_your_key_here
   ```

   > The AI runs entirely through the Cloud Functions proxy. **Never** put the key
   > in `src/environments/*` or commit it — GitHub push protection will block the
   > push, and any key in the frontend bundle is exposed to all users.

---

## 1. Build the frontend (production)

From the project root:

```bash
npm run build:prod        # ng build --configuration production → dist/taskpilot/browser
```

> The `bundle initial exceeded budget` line is a **warning, not an error** — the
> build still succeeds.

## 2. Build the Cloud Functions

```bash
npm --prefix functions run build     # compiles functions/src → functions/lib (tsc)
```

## 3. Deploy

**Everything at once:**

```bash
firebase deploy --project taskpilot-ad725
```

**Or one target at a time** (faster — deploy only what changed):

```bash
# Frontend only (after step 1)
firebase deploy --only hosting --project taskpilot-ad725

# Cloud Functions only (after step 2; needs Blaze + functions/.env)
firebase deploy --only functions --project taskpilot-ad725

# Firestore security rules only (after editing firestore.rules)
firebase deploy --only firestore:rules --project taskpilot-ad725

# Firestore indexes only (after editing firestore.indexes.json)
firebase deploy --only firestore:indexes --project taskpilot-ad725
```

---

## Typical "publish my latest changes" flow

```bash
npm run build:prod
npm --prefix functions run build
firebase deploy --only hosting,functions,firestore:rules --project taskpilot-ad725
```

To also push the source to GitHub:

```bash
git add -A
git commit -m "your message"
git push
```

---

## Notes & gotchas

- **`--project taskpilot-ad725`** can be omitted — `.firebaserc` sets it as the
  default. It's included above just to be explicit.
- After a functions deploy you may see a non-fatal *"could not set up cleanup
  policy"* warning. It's harmless; optionally run this once to auto-clean old
  build images:
  ```bash
  firebase functions:artifacts:setpolicy --project taskpilot-ad725
  ```
- **Groq / AI key:** lives only in `functions/.env` (server-side). If AI features
  stop working after a deploy, confirm that file exists and the functions were
  redeployed.
- **Rules/indexes** are deployed from `firestore.rules` and
  `firestore.indexes.json`. If a Firestore query errors in the console with a
  "create index" link, click it (or add the index to `firestore.indexes.json`
  and redeploy indexes).
- **Local dev** (no deploy needed): `npm start` runs the app at
  `http://localhost:4200` (or another port). For the Firebase emulators, see
  the `emulators` block in `firebase.json`.

---

## Reference: what each config file controls

| File | Controls |
|------|----------|
| `firebase.json` | Hosting path/rewrites, functions source, emulator ports |
| `.firebaserc` | Default project alias (`taskpilot-ad725`) |
| `firestore.rules` | Firestore security rules |
| `firestore.indexes.json` | Firestore composite indexes |
| `functions/.env` | Server-side secrets (Groq key) — git-ignored |
| `angular.json` | Angular build config, output path, budgets |
