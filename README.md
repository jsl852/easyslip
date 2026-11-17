# EasySlip

EasySlip is a receipt-led accounting workspace for Hong Kong SMEs. You sign in, upload a batch of receipts, invoices, or bank slips, review what was extracted, and keep the double-entry journal as the source of truth. An Excel pack then lists those journal lines and uses formulas to roll them up to a trial balance, balance sheet, and profit and loss.

This is an original v1. It follows the public behavior of the [247 AICFO HK demo](https://www.youtube.com/watch?v=Pzu6l8gZ4kU) (batch upload, human review, journal lines, formula workbook). It does not reuse that product's code or services.

Out of scope: profits-tax filing, bank feeds, payroll, inventory, and multi-company consolidation. Employee cash bands can be added as settlement accounts. A separate mobile claims app is not included. The same site can be installed on a phone.

## What you can do

1. Sign in with Google. A local development sign-in is available only when you turn it on.
2. Create one company. EasySlip seeds a Hong Kong chart of accounts, categories, and a few starter keyword rules.
3. Upload up to 20 PDFs or images at a time, marked as an expense, purchase, or sale, against a bank, cash, card, or staff cash band.
4. Wait for extraction. With `XAI_API_KEY` set, EasySlip calls xAI's OpenAI-compatible API. A photo that shows more than one physical slip is separated first, and each slip becomes its own document. If the edges are not clear enough to crop, the original photo stays in the list and says how many slips were found, instead of merging them into one entry. Without a key, or if the call fails, the file is marked **AI fallback** and waits for manual entry. A file named like `2024-03-02_cafe_86.50.jpg` fills the date, merchant, and amount from the name only, and says so.
5. Correct the date, amount, category, and settlement account. Saving rewrites the journal lines. Approving removes the row from the review queue.
6. Maintain the chart, categories, keyword rules, and opening balances.
7. Preview a period and download an Excel workbook. `JL` holds values. Account sheets, `SJ` / `PJ` / `EJ`, `TB`, `BS`, and `PL` use formulas. Yellow opening cells on `TB` are editable so a migrated balance can be adjusted in the sheet. Documents outside the period stay in the database and are left out of the file.

Journal lines are balanced pairs:

- Expense (`EJ`) and purchase (`PJ`): debit the category account, credit the settlement account.
- Sale (`SJ`): debit the settlement account, credit the revenue account.

## Local setup

Requirements: Node.js 22 and PostgreSQL 16.

```bash
docker compose up -d
cp .env.example .env
```

Edit `.env`:

- `DATABASE_URL` — for the compose file, `postgres://easyslip:easyslip@127.0.0.1:5432/easyslip`
- `AUTH_SECRET` — `openssl rand -base64 32`
- `AUTH_URL` — `http://localhost:5173`
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` — from Google Cloud, with redirect URI `http://localhost:5173/auth/callback/google`
- `XAI_API_KEY` — optional. Leave it empty to use the manual fallback.
- `AWS_REGION`, `S3_BUCKET`, `AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY` — optional. Leave all four unset locally so uploads stay in Postgres. For Cloudflare R2, also set `S3_ENDPOINT` and use `AWS_REGION=auto`.

Local password sign-in, off in any shared environment:

```bash
AUTH_DEV_LOGIN=true
DEV_LOGIN_PASSWORD=a-local-password
```

Then:

```bash
npm install
npm run db:migrate
npm run dev
```

Open `http://localhost:5173`. The app listens on `0.0.0.0` so it can run in a container.

```bash
npm test
npm run check
npm run build
```

`npm test` always runs the journal, statement, and workbook tests. The Postgres round-trip runs only when `DATABASE_URL` is set.

To run the production build locally:

```bash
npm run build
ORIGIN=http://127.0.0.1:4173 BODY_SIZE_LIMIT=80M PORT=4173 HOST=0.0.0.0 node build
```

## Environment variables

| Name | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection string |
| `DATABASE_SSL` | on Render | `require` for Render Postgres. Leave unset locally. |
| `AUTH_SECRET` | yes | Auth.js session signing secret, at least 32 characters |
| `AUTH_URL` | yes in production | Public origin, no path, such as `https://your-service.onrender.com` |
| `AUTH_TRUST_HOST` | recommended | `true` when the app is behind Render's proxy |
| `GOOGLE_CLIENT_ID` | for Google sign-in | Google OAuth client id |
| `GOOGLE_CLIENT_SECRET` | for Google sign-in | Google OAuth client secret |
| `XAI_API_KEY` | no | xAI key. Empty means the marked manual fallback |
| `XAI_MODEL` | no | Defaults to `grok-4-fast` |
| `XAI_API_BASE` | no | Defaults to `https://api.x.ai/v1` |
| `AWS_REGION` | no | Region of the private bucket. Use an AWS region, or `auto` for Cloudflare R2. Set with the other three storage variables, or leave all four unset |
| `S3_BUCKET` | no | Private bucket for new receipt files and workbooks |
| `AWS_ACCESS_KEY_ID` | no | Access key with put, get, and delete on `companies/*` in that bucket |
| `AWS_SECRET_ACCESS_KEY` | no | Secret for that access key. Never commit it |
| `S3_ENDPOINT` | no | HTTPS endpoint for an S3-compatible service. For R2, `https://<account-id>.r2.cloudflarestorage.com`. Leave unset for Amazon S3. `AWS_ENDPOINT_URL` is an alias |
| `AUTH_DEV_LOGIN` | no | `true` enables the local password form |
| `DEV_LOGIN_PASSWORD` | with dev login | At least 8 characters. Do not set this on Render |
| `HOST` | on Render | `0.0.0.0` |
| `PORT` | set by Render | The web process binds to this port |
| `ORIGIN` | local production build | Public origin, such as `http://127.0.0.1:4173`. The Node adapter otherwise treats the request as HTTPS |
| `PROTOCOL_HEADER` | on Render | `x-forwarded-proto`, so Auth.js sees HTTPS behind Render's proxy |
| `HOST_HEADER` | on Render | `x-forwarded-host` |
| `BODY_SIZE_LIMIT` | on Render | `80M`. Each file is still limited to 8 MB inside the app |

Do not commit `.env` or real keys. `.env.example` has placeholders only.

## On a phone

Sign in, create the company, then take a receipt photo or choose one from the library. The queue button stays along the bottom of the screen. A picture of two slips side by side becomes two receipts, and each one can be previewed. When reading finishes, open the preview, correct the line, and approve it.

### Add to the Home Screen

The production site is already served over HTTPS.

iPhone, in Safari: open the site, tap Share, then Add to Home Screen. iOS does not offer an automatic install banner, so the Share sheet is the install path. The icon is labelled EasySlip and opens without the Safari toolbar.

Android, in Chrome: open the site, then Install app, or use the browser menu and choose Add to Home Screen or Install. The installed app opens standalone.

The icon opens `/?source=pwa`. A signed-in member with a company continues into the workspace. A signed-in member without a company continues to company setup. Anyone else stays on the site root.

### What the service worker stores

The service worker caches the app shell only: hashed JavaScript and CSS, the icons, the favicon, and `offline.html`. It does not cache receipt images, report downloads, workspace HTML, SvelteKit `__data` responses, or auth and sign-out responses. Those requests are network-only and use `cache: "no-store"`. If a private page cannot be loaded, EasySlip shows the offline page instead of a saved copy.

The installed app still needs a connection to sign in, upload, and read a receipt. A flaky connection can reuse the saved shell files. Private data is never reused from cache. The path rules live in `src/service-worker.ts` and `src/lib/pwa/cache-policy.ts`.

## Render

`render.yaml` describes a free web service and a free Postgres database in Oregon. It is not deployed by this repository. Free Postgres expires 30 days after creation, and a free web service sleeps after 15 minutes without traffic. The web service disk is ephemeral, so receipt files and workbooks are not stored on it. See [Stored files](#stored-files).

On first Blueprint setup, fill in `AUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and optionally `XAI_API_KEY`. For a private bucket, also set `AWS_REGION`, `S3_BUCKET`, `AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY`. For Cloudflare R2, set `AWS_REGION` to `auto` and `S3_ENDPOINT` to `https://<account-id>.r2.cloudflarestorage.com`. Leave the four variables unset to keep file bytes in Postgres. `AUTH_SECRET` is generated. `DATABASE_URL` comes from the database. The start command runs `npm run db:migrate` before the app listens. Render's free plan does not support a pre-deploy command.

Set the Google redirect URI to `https://<your-service>.onrender.com/auth/callback/google`.

## Stored files

Receipt images, PDFs, and Excel workbooks are written either to a private S3-compatible bucket or to Postgres. They are not written to the web service disk. Amazon S3 and Cloudflare R2 both work. The bucket stays private.

When `AWS_REGION`, `S3_BUCKET`, `AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY` are all set, a new upload or workbook is saved with a server-side `PutObject`. EasySlip does not set a public ACL and does not list the bucket. Preview and download stay on the signed-in routes `/app/documents/:id/file` and `/app/reports/:id/download`. Those routes read the object on the server and return the bytes. They do not redirect the browser to the bucket, and they do not hand out a bucket URL.

`S3_ENDPOINT` is optional. Leave it unset for Amazon S3, which keeps the SDK's default endpoint and virtual-hosted requests. Set it to an `https` URL for another S3-compatible service. Cloudflare R2 uses `AWS_REGION=auto` and `S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`. `AWS_ENDPOINT_URL` is accepted as an alias of `S3_ENDPOINT`. With a custom endpoint, EasySlip sends path-style requests and asks the SDK to attach checksums only when the operation requires them, which R2 accepts. `S3_ENDPOINT` on its own leaves new files in Postgres. If it is set while the four variables are only partly set, the upload fails closed.

Create an AWS bucket with Block Public Access on, ACLs disabled, and default encryption on. Give the IAM user only `s3:PutObject`, `s3:GetObject`, and `s3:DeleteObject` on `arn:aws:s3:::<bucket>/companies/*`. `DeleteObject` is used to remove an object if the database row cannot be saved. Do not add a bucket policy that allows `Principal: "*"`. For R2, create a private bucket and an API token that can read, write, and delete objects in that bucket. Do not enable the r2.dev public URL.

When the four variables are unset, new files are stored in Postgres. That is the local default. Set all four, or none. A partial set fails the next upload instead of quietly using the database. Files already stored in Postgres stay there and remain readable after object storage is turned on. The migration adds `storage_key` and lets `documents.file_data` be null when the bytes live in the bucket.

## Stack

SvelteKit, TypeScript, PostgreSQL, Drizzle, Auth.js with Google OIDC, and ExcelJS. Extraction uses xAI when `XAI_API_KEY` is present. Processing runs in the web process and resumes queued documents on the next workspace request, which fits a single free instance.
