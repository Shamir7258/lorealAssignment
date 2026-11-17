# Stage 1: Task, Assumptions, Research (items 4 and 5)

## 1. Task restated

Build a 1-day technical proposal for an **L'Oréal Claims Intelligence Engine**. An evaluator attaches clinical study results to a cosmetic claim (e.g. "Reduces wrinkles by 20% in 4 weeks"). An LLM judges whether the evidence justifies the claim. The result is saved and shown in a React UI.

Deliverables:
1. Prisma schema: Claim and Assessment (relation, status enum, justified, confidenceScore, reasoning, model, timestamps)
2. NestJS `POST /api/claims/assess` (controller, service, validated DTO, OpenAI structured JSON output, persistence, handling of LLM failure, invalid JSON, timeout)
3. React JSX form + result display (Yes/No, confidence, reasoning, loading and error states), contract matching backend
4. Business process understanding (flow, actors, handoffs, where the engine fits)
5. Research (EU Reg. 1223/2009, Common Criteria, LLM-as-evaluator and limits, cited)
6. Architecture justification (NestJS, Prisma, structured outputs, audit trail, prompt versioning, human-in-the-loop, security, diagram)
7. Unconstrained roadmap
Final output: one Word document, code in appendices, readable in under 15 minutes.

## 2. Assumptions

| # | Assumption |
|---|---|
| A1 | Stack: NestJS + Prisma + PostgreSQL, React (JSX, Vite), TypeScript on the backend. Prisma chosen over TypeORM (brief allows either). |
| A2 | LLM: OpenAI Chat Completions with `response_format: json_schema` (strict). Model name is read from env (`OPENAI_MODEL`), not hardcoded; stored on each Assessment. |
| A3 | Scope is **assessment of one claim against one evidence text**. Auth, user management and the upstream steps (business proposal, claim-manager filtering) are out of code scope; they are described only in item 4. |
| A4 | Evidence is submitted as **plain text** (summary of study results), not file upload. |
| A5 | The endpoint creates the Claim and the Assessment in one call. Claim has text, product name and optional market; Assessment holds the verdict. One Claim has many Assessments (re-assessment, audit). |
| A6 | Status enum: `PENDING`, `COMPLETED`, `FAILED`, `NEEDS_REVIEW`. LLM verdict is advisory; a human reviewer has the final say (human-in-the-loop). Low confidence routes to `NEEDS_REVIEW`; threshold configurable (default 0.7, my choice, not a regulatory number). |
| A7 | Confidence is the model's self-reported 0-1 value. It is **not calibrated** and is labelled as such in the UI and doc. |
| A8 | Timeout default 30 s, no automatic retry beyond one on transient errors (my choice). |
| A9 | No real L'Oréal data or confidential material is used; example claims are illustrative. I have no knowledge of L'Oréal's internal tools or processes. The business flow comes only from the brief. |
| A10 | The engine supports, and does not replace, the Responsible Person's legal duty under EU law. It makes no legal-compliance determination. |
| A11 | Primary regulatory frame is the EU; other regions appear only in the roadmap. |
| A12 | Secrets (OpenAI key, DB URL) come from environment variables; a `.env.example` is provided, never real keys. |
| A13 | I cannot run against the live OpenAI API without a key. Code will be checked by compiling/type-checking and, if possible, by tests with a mocked client. I will report this honestly. |

No question needs to block the project, so none is asked.

## 3. Item 4: Business process understanding

**Actors**
- **Business / marketing team**: proposes the product and desired claims.
- **Claim manager**: filters claims for applicability and feasibility.
- **R&I scientist (e.g. Paris)**: runs formulation tests, submits results supporting the claim.
- **Evaluator**: tests the product against the claims (instrumental, clinical, consumer perception), submits a report.
- **Engine (proposed)**: LLM-assisted check of claim vs evidence.
- **Responsible Person** (regulatory role under Reg. 1223/2009, Art. 4): legally accountable; keeps the Product Information File.

**Flow and handoffs**
1. Business proposes product + claims -> *handoff: claim list to claim manager*
2. Claim manager filters for applicability/feasibility -> *approved claims to R&I*
3. Scientist runs formulation tests, submits results -> *handoff: results to evaluator*
4. Evaluator tests product against claims, writes report with study results
5. **Engine step**: claim + evidence -> verdict (justified Y/N, confidence, reasoning) saved to DB
6. Human review of the verdict (mandatory for low confidence or "not justified") -> claim manager decides to keep, reword or drop the claim
7. Substantiation goes into the Product Information File (my assumption on where it ends up, consistent with Reg. 655/2013 which ties claims to documentation).

**Where the engine fits:** between steps 4 and 6, as a **second-opinion triage tool**. It speeds up the first read of the evidence and gives claim managers a consistent, recorded rationale. It does not approve claims.

## 4. Item 5: Research findings

### 4.1 Claim substantiation in EU cosmetics

- **Regulation (EC) No 1223/2009, Article 20**: claims must not imply characteristics or functions a product does not have. It also empowers the Commission to adopt common criteria for claims. Article 20 does not cover every kind of marketing statement; the common criteria apply only when Art. 20 applies.
- **Commission Regulation (EU) No 655/2013** sets the **common criteria**, applicable from 11 July 2013. Aim: high consumer protection against misleading claims. The six criteria, from my background knowledge, **to be verified against the Annex text before the final document**: legal compliance, truthfulness, evidential support, honesty, fairness, informed decision-making. The search I ran confirmed the first two by name only.
- The Responsible Person must be able to substantiate claims; evidence must match the documentation in the Product Information File.
- **Non-binding Technical Document on Claims (2017)** (Sub-Working Group on Claims, endorsed by the Working Group on Cosmetic Products; not a Commission-adopted act): gives examples and evidence best practice. Evidence may be in vitro, instrumental, sensory, or human studies. "Clinically tested" implies human testing under qualified supervision per a clinical protocol. Secondary sources mention later updates (2019, 2023); **not confirmed**.
- Practical points from secondary commentary (not from the primary text, treat as commentary): defined comparator, appropriate study design, and statistical significance are expected for efficacy claims.

**Implication for the engine:** the prompt should ask the LLM to check evidence support (study type, sample, duration, endpoint vs claimed effect, statistical significance, comparator) and should not attempt a legal-compliance ruling.

### 4.2 LLM-as-evaluator

- Zheng et al. (2023) show LLM judges can approximate human preferences scalably with explanations, but exhibit **position, verbosity and self-enhancement bias** and limited reasoning; some biases are mitigable.
- Surveys (2024) group limitations into biases, adversarial attacks (e.g. prompt injection in the judged text) and inherent weaknesses.
- Not verified, so **not to be used as facts**: specific numbers such as 65% consistency and 10% self-win rate (from a blog).

### 4.3 Limits that apply to this engine
- Numeric reasoning over study statistics is error-prone (e.g. whether 20% improvement was statistically significant and measured at 4 weeks).
- Self-reported confidence is uncalibrated.
- Evidence text is untrusted input (prompt injection).
- Output can vary run to run; need low temperature, stored prompt version and model.
- Domain accuracy is unmeasured until compared with expert labels (roadmap item).
- The tool gives no legal opinion; mandatory human review.

## 5. Sources

1. Regulation (EC) No 1223/2009, Art. 20: https://legislation.gov.uk/eur/2009/1223/article/20 (UK-hosted retained copy; EUR-Lex is authoritative for the current EU text)
2. Commission Regulation (EU) No 655/2013: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32013R0655 and https://www.legislation.gov.uk/eur/2013/655
3. Technical Document on Claims, 3 July 2017 version (copy hosted by the Croatian Ministry of Health): https://zdravlje.gov.hr/UserDocsImages//2018 Savjetovanje sa zainteresiranom javnošću//Technical_document_CLAIMS_2017_en.pdf
4. HPRA (Ireland), Claims made about cosmetics: https://hpra.ie/regulation/cosmetics/labelling-and-claims/claims-made-about-cosmetics
5. Zheng et al., "Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena", 2023: https://arxiv.org/abs/2306.05685
6. "A Survey on LLM-as-a-Judge", 2024: https://arxiv.org/pdf/2411.15594
7. "LLMs-as-Judges: A Comprehensive Survey on LLM-based Evaluation Methods", 2024: https://arxiv.org/pdf/2412.05579

**Verification status:** I read only search summaries, not the full texts. Open items before Stage 5: confirm the six criteria wording from EUR-Lex, confirm the latest version of the Technical Document, and confirm Zheng et al. claims from the paper itself.
