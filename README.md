# L'Oréal Claims Intelligence Engine

A technical proposal and working prototype. An evaluator submits a cosmetic claim (e.g. "Reduces wrinkles by 20% in 4 weeks") with clinical study evidence. An LLM judges whether the evidence justifies the claim. The verdict is saved to PostgreSQL and shown in a React UI.

The LLM verdict is **advisory**. Low-confidence and "not justified" results are flagged for human review. This is an illustrative project built from the brief only; it uses no real company data.

## Contents

| Path | What it is |
|---|---|
| [backend/](backend/) | NestJS API, Prisma schema, LLM providers, unit tests |
| [frontend/](frontend/) | React (JSX, Vite) assessment form and result display |
| [proposal/Claims_Intelligence_Engine_Proposal.docx](proposal/Claims_Intelligence_Engine_Proposal.docx) | The proposal: business process, research, architecture, roadmap, code appendices |
| [proposal/](proposal/) | Stage notes in Markdown (assumptions and research, architecture and roadmap) |
| [BRIEF.md](BRIEF.md) | The original brief |

## Architecture

```
React UI (Vite, :5173)  --/api proxy-->  NestJS API (:3000)  --Prisma-->  PostgreSQL (:5432)
                                               |
                                               +--> LLM provider (OpenAI, local gateway, or mock)
```

Request path: validate input, save a Claim and a `PENDING` Assessment, call the LLM, validate the JSON, update the Assessment to `COMPLETED`, `NEEDS_REVIEW` or `FAILED`, respond.

## Prerequisites

- Node.js 20+ and npm
- Docker (for a local PostgreSQL), or any PostgreSQL 14+ you already have

## Quick start

### 1. Database

```bash
docker run -d --name claims-pg -p 5432:5432 \
  -e POSTGRES_USER=claims -e POSTGRES_PASSWORD=claims_dev -e POSTGRES_DB=claims postgres:16
```

These credentials are for local development only. The container has no volume, so removing it deletes the data.

### 2. Backend

```bash
cd backend
cp .env.example .env        # then edit .env (see "LLM providers" below)
npm install
npx prisma migrate dev      # creates the tables
npm run build
npm start                   # http://localhost:3000
```

Set `DATABASE_URL` in `.env` to match your database, for example
`postgresql://claims:claims_dev@localhost:5432/claims?schema=public`.

### 3. Frontend

```bash
cd frontend
npm install
npm run dev                 # http://localhost:5173 (proxies /api to :3000)
```

If `npm install` fails with a 404 for a rollup tarball, keep the `overrides` entry in `frontend/package.json`. It pins rollup to a version the registry serves.

## LLM providers

The backend picks a provider at startup, in this order:

| Condition | Provider | Stored model name |
|---|---|---|
| `OPENAI_API_KEY` is set | OpenAI Chat Completions with strict JSON-schema output | value of `OPENAI_MODEL` |
| No key, `LLM_GATEWAY_URL` is set | A local HTTP gateway: `POST {prompt}` returns `{result}`. The reply is parsed and validated like the OpenAI one. | `local-gateway` |
| Neither | A rule-based **mock**. It is a demo only, not an AI judgement; reasoning is prefixed `[MOCK]`. | `mock-llm` |

Rows from the gateway or mock are test data, not OpenAI results. A real OpenAI call has not yet been tested in this repository.

## Configuration (`backend/.env`)

| Variable | Purpose | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | none, required |
| `OPENAI_API_KEY` | OpenAI key. Leave empty to use the gateway or mock. Never commit it. | empty |
| `OPENAI_MODEL` | Model for OpenAI calls. Must support JSON-schema output. | `gpt-4o-mini` in the example |
| `OPENAI_TIMEOUT_MS` | LLM call timeout, also used for the gateway | `30000` |
| `REVIEW_CONFIDENCE_THRESHOLD` | Below this confidence, status is `NEEDS_REVIEW` | `0.7` |
| `LLM_GATEWAY_URL` | Optional local gateway URL | empty |
| `CORS_ORIGIN` | Allowed browser origin | `http://localhost:5173` |
| `PORT` | API port | `3000` |

## API

`POST /api/claims/assess`

Request:

```json
{
  "claimText": "Reduces wrinkles by 20% in 4 weeks",
  "productName": "Serum X",
  "market": "EU",
  "evidence": "Randomised, double-blind, vehicle-controlled study, n=60, 4 weeks. Wrinkle depth reduced by 22% vs baseline (p<0.01)."
}
```

`market` is optional. Limits: claim 500 characters, product name 200, market 100, evidence 20,000. Unknown fields are rejected.

Response `201`:

```json
{
  "assessmentId": "uuid",
  "claimId": "uuid",
  "status": "COMPLETED",
  "justified": true,
  "confidenceScore": 0.8,
  "reasoning": "…",
  "model": "gpt-4o-mini",
  "promptVersion": "v1",
  "createdAt": "2026-11-17T10:18:57.117Z"
}
```

`status` is `COMPLETED`, or `NEEDS_REVIEW` when confidence is below the threshold or the claim is judged not justified. `confidenceScore` is the model's self-reported 0 to 1 value and is **not calibrated**.

Errors use the body `{ "statusCode": n, "message": … }`:

| Code | Meaning |
|---|---|
| 400 | Validation failed (`message` is a list) |
| 502 | LLM call failed, or it returned invalid JSON |
| 504 | LLM call timed out |

Failed calls are still saved, with status `FAILED` and an error message.

Try it:

```bash
curl -X POST http://localhost:3000/api/claims/assess \
  -H 'Content-Type: application/json' \
  -d '{"claimText":"Reduces wrinkles by 20% in 4 weeks","productName":"Serum X","evidence":"Randomised, double-blind, vehicle-controlled study, n=60, 4 weeks. Wrinkle depth reduced by 22% vs baseline (p<0.01)."}'
```

## Using the UI

Open http://localhost:5173. The form has two example buttons, live character counters, Ctrl+Enter to submit, a Cancel button while waiting, a colour-coded confidence bar, Copy result, and a list of this session's assessments. The session list is held in page memory only and clears on refresh.

## Checking the database

Tables: `Claim` and `Assessment`. Names are mixed-case, so quote them in SQL.

```bash
docker exec -it claims-pg psql -U claims -d claims
# then:  \dt     select * from "Assessment";
```

Or run `cd backend && npx prisma studio` and open http://localhost:5555. A GUI client works too: host `localhost`, port `5432`, database `claims`.

## Tests

```bash
cd backend && npm test
```

The unit tests mock the LLM and the database. They cover the service (status routing, 502 and 504 mapping), verdict parsing and the mock provider. There are no tests for the OpenAI call, the gateway call or the frontend.

## Known limitations

- No test against the real OpenAI API.
- Each submission creates a new Claim; there is no endpoint to re-assess an existing claim.
- Confidence is uncalibrated and accuracy against expert judgement is unmeasured.
- Not built: authentication, rate limiting, a human reviewer queue, and a prompt registry table. The proposal's architecture section lists what production would need.
- Prompt-injection defence is limited to fencing the evidence and instructing the model to ignore it. It reduces the risk and does not remove it.
- The regulatory research was done from search results and secondary summaries because EUR-Lex could not be fetched. Check the legal wording on EUR-Lex before relying on it.

## Proposal sources

The proposal lists its sources in the Word document. Main ones: Regulation (EC) No 1223/2009 Article 20, Commission Regulation (EU) No 655/2013, the Commission's Technical Document on cosmetic claims (version of 3 July 2017), and Zheng et al. 2023, "Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena".
