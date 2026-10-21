# Cloud Functions

Three unrelated jobs live here:

- **Push notifications** (`notifyOn*`) — fire on Firestore writes, already deployed and running.
- **`scheduledFirestoreExport`** — a nightly full-database backup. This is the server-side
  counterpart to the "Export data backup" button in the app itself (More → Administration):
  that one is a manual, on-demand JSON download; this one runs on its own every night at
  3am Gulf Standard Time, regardless of whether anyone remembers to click the button.
- **`aiAssistant`** — the backend for the "AI Assistant" chat panel in the app (More →
  AI Assistant). It reads a summary of the live business data from Firestore and calls the
  Claude API to answer questions or draft messages. Needs a one-time secret setup before it
  will actually answer anything — see below.

## Deploying the backup export

One-time setup, then a normal deploy:

1. **The Firebase project must be on the Blaze (pay-as-you-go) plan.** Scheduled functions
   need Cloud Scheduler, which isn't available on the free Spark plan. Blaze still has a
   generous free tier — a once-nightly export of a small Firestore database costs
   effectively nothing. Upgrade at console.firebase.google.com → Usage and billing.
2. **Grant the export permission.** The Cloud Functions runtime needs the
   "Cloud Datastore Import Export Admin" IAM role to call the Firestore export API — it's
   not included by default. In the Google Cloud Console → IAM, find the service account
   named `<project-id>@appspot.gserviceaccount.com` (the default App Engine / Cloud
   Functions service account) and add the role **Cloud Datastore Import Export Admin**
   (`roles/datastore.importExportAdmin`).
3. **Deploy:**
   ```sh
   cd functions
   npm install
   firebase deploy --only functions:scheduledFirestoreExport
   ```
   (or `firebase deploy --only functions` to deploy everything in this directory at once.)

That's it — no separate Cloud Storage bucket to create. Exports land in the project's
existing default Storage bucket, under `firestore-backups/`.

## Keeping old exports from piling up

Each export is many small files, and without cleanup they'll accumulate indefinitely.
Add a lifecycle rule on the bucket to auto-delete anything under that path older than,
say, 30 days — Google Cloud Console → Cloud Storage → your bucket → Lifecycle → Add rule
→ "Delete object" → condition "Age: 30 days", prefix `firestore-backups/`. (This has to be
a bucket-level lifecycle rule, not something `scheduledFirestoreExport` itself can do —
an export job can still be writing when the function that started it has already returned.)

## Restoring from a backup

Exports are a sequence of empty-marker + data files under one timestamped folder, not a
single downloadable file. To restore (this **overwrites** live data for any collection
being restored — only do this to recover from real data loss, into the same or a fresh
project):

```sh
gcloud firestore import gs://<project-id>.firebasestorage.app/firestore-backups/<export-folder>
```

List available exports first with:

```sh
gsutil ls gs://<project-id>.firebasestorage.app/firestore-backups/
```

## Setting up the AI Assistant

One-time setup, then a normal deploy:

1. **Get an Anthropic API key** from console.anthropic.com if you don't already have one.
2. **Store it as a Cloud Functions secret** (never put it in code or an env file):
   ```sh
   cd functions
   firebase functions:secrets:set ANTHROPIC_API_KEY
   ```
   This prompts for the key value and stores it in Google Secret Manager — the function
   declares it via `defineSecret`, so it's only ever readable at runtime by this function.
3. **Deploy:**
   ```sh
   npm install
   firebase deploy --only functions:aiAssistant
   ```
   (or `firebase deploy --only functions` to deploy everything in this directory at once.)

That's it — the "AI Assistant" page in the app will start giving real answers instead of
an error about missing setup. There's no separate billing to arrange beyond your own
Anthropic API usage; calls are small (one bounded data summary plus the chat text) so
cost per question is low.

Access control here is intentionally lightweight, matching the rest of this app: since
there's no Firebase Auth, the function just checks that the `username` the client sends
is a real account in `ledger/users` and isn't a `client`/`supplier` portal login. It's
not meant to withstand a determined attacker — just keep the endpoint from being wide
open — the same trust level the app already runs on everywhere else.
