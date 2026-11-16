# EasySlip

EasySlip is a receipt-led accounting workspace for Hong Kong SMEs. You sign in, upload a batch of receipts, invoices, or bank slips, review what was extracted, and keep the double-entry journal as the source of truth. An Excel pack then lists those journal lines and uses formulas to roll them up to a trial balance, balance sheet, and profit and loss.

This is an original v1. It follows the public behavior of the [247 AICFO HK demo](https://www.youtube.com/watch?v=Pzu6l8gZ4kU) (batch upload, human review, journal lines, formula workbook). It does not reuse that product's code or services.

Out of scope: profits-tax filing, bank feeds, payroll, inventory, and multi-company consolidation. Employee cash bands can be added as settlement accounts. A separate mobile claims app is not included.

## What you can do

1. Sign in with Google. A local development sign-in is available only when you turn it on.
2. Create one company. EasySlip seeds a Hong Kong chart of accounts, categories, and a few starter keyword rules.
3. Upload up to 20 PDFs or images at a time, marked as an expense, purchase, or sale, against a bank, cash, card, or staff cash band.
4. Wait for extraction. With `XAI_API_KEY` set, EasySlip calls xAI's OpenAI-compatible API. Without a key, or if the call fails, the file is marked **AI fallback** and waits for manual entry. A file named like `2024-03-02_cafe_86.50.jpg` fills the date, merchant, and amount from the name only, and says so.
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
| `AUTH_DEV_LOGIN` | no | `true` enables the local password form |
| `DEV_LOGIN_PASSWORD` | with dev login | At least 8 characters. Do not set this on Render |
| `HOST` | on Render | `0.0.0.0` |
| `PORT` | set by Render | The web process binds to this port |
| `ORIGIN` | local production build | Public origin, such as `http://127.0.0.1:4173`. The Node adapter otherwise treats the request as HTTPS |
| `PROTOCOL_HEADER` | on Render | `x-forwarded-proto`, so Auth.js sees HTTPS behind Render's proxy |
| `HOST_HEADER` | on Render | `x-forwarded-host` |
| `BODY_SIZE_LIMIT` | on Render | `80M`. Each file is still limited to 8 MB inside the app |

Do not commit `.env` or real keys. `.env.example` has placeholders only.

## Render

`render.yaml` describes a free web service and a free Postgres database in Oregon. It is not deployed by this repository. Free Postgres expires 30 days after creation, and a free web service sleeps after 15 minutes without traffic. Uploaded files and workbooks are stored in Postgres, because the web service disk is ephemeral.

On first Blueprint setup, fill in `AUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and optionally `XAI_API_KEY`. `AUTH_SECRET` is generated. `DATABASE_URL` comes from the database. The release command runs `npm run db:migrate` before the new instance starts.

Set the Google redirect URI to `https://<your-service>.onrender.com/auth/callback/google`.

## Stack

SvelteKit, TypeScript, PostgreSQL, Drizzle, Auth.js with Google OIDC, and ExcelJS. Extraction uses xAI when `XAI_API_KEY` is present. Processing runs in the web process and resumes queued documents on the next workspace request, which fits a single free instance.
