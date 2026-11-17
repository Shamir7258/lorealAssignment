# Stage 4: Architecture Justification (item 6) and Roadmap (item 7)

## 6. Technical architecture justification

### 6.1 Diagram

```
 Evaluator / Claim manager
          |  (browser)
          v
 +--------------------+   POST /api/claims/assess    +----------------------------+
 |  React UI (Vite)   | ---------------------------> |  NestJS API                |
 |  form + result     | <--------------------------- |  Controller -> Service     |
 +--------------------+   verdict JSON (201)         |  ValidationPipe (DTO)      |
                          or error {statusCode,msg}  +-----+----------------+-----+
                                                           |                |
                                       Prisma (SQL)        |                | HTTPS, timeout 30s,
                                                           v                v 1 retry, JSON schema
                                              +---------------------+   +-------------------+
                                              | PostgreSQL          |   | OpenAI API        |
                                              | Claim 1--* Assessment|  | structured output |
                                              | status, model,      |   +-------------------+
                                              | promptVersion, ...  |
                                              +---------------------+
                                                           |
                                                           v
                                              Human reviewer (NEEDS_REVIEW queue)
```

Request path: validate -> save Claim + PENDING Assessment -> call LLM -> validate JSON -> update Assessment (COMPLETED / NEEDS_REVIEW / FAILED) -> respond.

### 6.2 Why these choices

| Choice | Why | Trade-off |
|---|---|---|
| **NestJS** | Opinionated modules, DI and decorator-based validation (DTO + `ValidationPipe`) keep controller, service and LLM client separate and testable (the unit tests mock the LLM and DB in a few lines). TypeScript end to end with the React app. | More boilerplate than Express for a small service. |
| **Prisma + PostgreSQL** | Typed client generated from one schema; migrations are versioned; relational model fits Claim -> many Assessments and audit queries (by status, model, prompt version). | Prisma adds a generate step; complex reporting may need raw SQL. |
| **Structured outputs (JSON schema, strict)** | The model is constrained to `{justified, confidence, reasoning}`, which removes most parsing failures. The server still re-validates (type, 0-1 range, non-empty reasoning) because schema conformance is not a correctness guarantee and refusals/truncation can occur. | Schema only controls shape, not truth. |
| **Separate Claim and Assessment** | A claim can be re-assessed with new evidence, a newer prompt or a different model without losing history. | Current endpoint creates a new Claim on every call (see 6.4). |

### 6.3 Cross-cutting concerns

**Audit trail.** Every call creates an Assessment row before the LLM is called, so failures are recorded (`FAILED` + `errorMessage`). Each row stores the evidence as submitted, `model`, `promptVersion` and timestamps. *Implemented.* *Not yet:* who made the request (needs auth), an immutable append-only log of human decisions.

**Prompt versioning.** Prompt text lives in one file with a `PROMPT_VERSION` constant stored on each Assessment, so any verdict can be traced to the exact prompt. *Implemented as a manual convention*; the full prompt text per version is recoverable only from git history. Proposed: a `PromptVersion` table keyed by version, and a CI check that fails if the prompt changes without a version bump.

**Human-in-the-loop.** The LLM is advisory. A verdict goes to `NEEDS_REVIEW` when confidence is below the threshold (default 0.7, configurable) or when the claim is judged not justified. The UI states this. This matters because (a) the confidence is self-reported and uncalibrated, and (b) the legal accountability stays with the Responsible Person (Reg. 1223/2009). *Implemented:* the status and the UI flag. *Not yet:* the reviewer queue, approve/override action and reviewer identity.

**Security.**
- Implemented: secrets only from environment variables (server fails at startup if missing); DTO validation with whitelist and `forbidNonWhitelisted`; length limits (evidence 20,000 chars); evidence fenced in `<evidence>` tags with an instruction to treat it as data (reduces, does not eliminate, prompt injection); LLM errors mapped to generic 502/504 messages with no provider detail leaked; CORS restricted to a configured origin; 30 s timeout and one retry.
- Not implemented, required before production: authentication and role-based access (claim manager / evaluator / reviewer), rate limiting, TLS and security headers (e.g. helmet), encryption at rest and retention policy, a data-processing agreement and region check with the LLM provider because study data is confidential, and logging that avoids storing evidence in application logs.

**Reliability.** Timeouts, a single retry, and distinct 504 vs 502 responses. Not yet: queueing for long jobs, circuit breaker, idempotency key to prevent duplicate Claims on resubmit.

### 6.4 Known limitations of the current build
- No live test against OpenAI or PostgreSQL has been run (mocked unit tests only).
- Each submission creates a new Claim; there is no endpoint to re-assess an existing claim.
- Confidence is not calibrated; accuracy against expert judgement is unmeasured (see roadmap R6).
- Prompt does not receive structured study data, only free text, so numeric checks rely on the LLM.

---

## 7. Product roadmap (no constraints)

Ordered by dependency. Items marked (*) I consider the highest value or the prerequisite for others.

| # | Item | What it adds |
|---|---|---|
| R1 (*) | **Evaluation against expert labels** | Build a labelled set of claims + evidence judged by claim managers/scientists. Measure agreement, false-justify rate (the costly error), and whether confidence is calibrated (calibration curve). Gate every prompt/model change on it. Do this first: without it, no accuracy claim can be made. |
| R2 (*) | **Human review workflow** | Reviewer queue for `NEEDS_REVIEW`, approve/override with reason, reviewer identity, immutable decision log. Feeds R1 with new labels. |
| R3 | **Statistical-test extraction** | Parse study reports into structured fields (n, endpoint, effect size, p-value, CI, comparator, duration) and check them deterministically against the claim's number and time frame. Moves numeric checking out of the LLM. |
| R4 | **RAG over past studies and claims** | Retrieve similar earlier claims, studies and prior decisions so verdicts are consistent and cite precedents. Requires access control per brand/region. |
| R5 | **Multi-evaluator consensus** | Run several prompts or models, compare verdicts; disagreement automatically routes to review. Reduces single-model bias (self-enhancement, position effects reported in LLM-as-judge research). |
| R6 | **Claim-manager dashboard** | Queue, history per claim, filters by status/product/market, trend of justified rate, reviewer workload, model/prompt drift. |
| R7 | **Regulatory-region rules** | Encode region-specific requirements (EU common criteria, and other markets such as UK, US, China, which have different rules and must be researched with regulatory affairs) as configurable rule sets in the prompt and checks. |
| R8 | **Document ingestion** | Upload PDF/Word study reports with OCR and table extraction; link evidence to the Product Information File. |
| R9 | **Platform hardening** | SSO, RBAC, audit export, data residency options, prompt registry with approvals, monitoring of cost, latency and failure rate. |
| R10 | **Upstream/downstream integration** | Connect to product proposal, claim filtering and PIF systems so the engine sits inside the existing flow instead of beside it. |

**Suggested sequencing:** R1 + R2 first (measure and capture human decisions), then R3 + R5 (improve accuracy), R4 + R6 (scale and visibility), R7-R10 (breadth and production).

## Stage 4 check against the brief
- Item 6 covers NestJS, Prisma, structured outputs, audit trail, prompt versioning, human-in-the-loop, security, with a diagram: yes.
- Item 7 covers the examples listed in the brief (RAG, statistical extraction, consensus, dashboard, regional rules, accuracy vs expert labels): yes.
- Claims about the code are marked "implemented" or "not yet" and match the Stage 2 and 3 code.
