import { useEffect, useRef, useState } from 'react';

/*
 * API contract (matches backend/src/claims/dto/assess-claim.dto.ts)
 * Request  POST /api/claims/assess
 *   { claimText, productName, evidence, market? }
 * Response 201
 *   { assessmentId, claimId, status: "COMPLETED" | "NEEDS_REVIEW", justified,
 *     confidenceScore, reasoning, model, promptVersion, createdAt }
 * History  GET /api/claims?page=1&pageSize=10
 *   -> { items: [Response fields + claimText, productName, market|null], total, page, pageSize, totalPages }
 *   newest first.
 * Error body: { statusCode, message }  (message is a string[] for validation errors)
 */
const API_URL = '/api/claims/assess';
const HISTORY_URL = '/api/claims';
const CLIENT_TIMEOUT_MS = 45000; // slightly above the server's 30 s LLM timeout
const LIMITS = { claimText: 500, productName: 200, market: 100, evidence: 20000 };
const PAGE_SIZES = [5, 10, 20];
const RING_R = 52;
const RING_C = 2 * Math.PI * RING_R; // circumference of the confidence ring
const LONG_REASONING = 260; // characters before "Read more" appears

const EMPTY = { claimText: '', productName: '', market: '', evidence: '' };

// Fictional examples to try the UI quickly.
const EXAMPLES = [
  {
    label: 'Strong evidence',
    values: {
      claimText: 'Reduces wrinkles by 20% in 4 weeks',
      productName: 'Serum X',
      market: 'EU',
      evidence:
        'Randomised, double-blind, vehicle-controlled study, n=60 women aged 40-60, 4 weeks, twice-daily application. ' +
        'Wrinkle depth measured by 3D skin imaging. Mean reduction of 22% vs baseline (p<0.01) and 21% vs vehicle (p<0.01).',
    },
  },
  {
    label: 'Weak evidence',
    values: {
      claimText: 'Reduces wrinkles by 20% in 4 weeks',
      productName: 'Serum X',
      market: 'EU',
      evidence:
        "Open-label pilot, n=12, no control group. Wrinkles reduced by 8% at week 4 (p<0.01). Participants were the company's own employees.",
    },
  },
];

/* ---------- small inline icons ---------- */
const Icon = ({ children, size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
const ShieldIcon = () => <Icon size={22}><path d="M12 3l8 3v6c0 4.5-3.2 7.9-8 9-4.8-1.1-8-4.5-8-9V6l8-3z" /><path d="M9 12l2 2 4-4" /></Icon>;
const CheckIcon = () => <Icon size={20}><path d="M5 12l5 5 9-10" /></Icon>;
const CrossIcon = () => <Icon size={20}><path d="M6 6l12 12M18 6L6 18" /></Icon>;
const CopyIcon = () => <Icon size={15}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></Icon>;
const EyeIcon = () => <Icon><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></Icon>;
const RefreshIcon = () => <Icon size={14}><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></Icon>;

/* ---------- stepper ---------- */
function Stepper({ steps }) {
  return (
    <ol className="stepper" aria-label="Progress">
      {steps.map((s, i) => (
        <li key={s.label} className={`step ${s.state}`} aria-current={s.state === 'active' ? 'step' : undefined}>
          <span className="step-dot">{s.state === 'done' ? <CheckIcon /> : i + 1}</span>
          <span className="step-label">{s.label}</span>
        </li>
      ))}
    </ol>
  );
}

/* ---------- result card (right) ---------- */
function ResultCard({ result, input, loading, elapsed, error, gauge, copied, onCopy }) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => setExpanded(false), [result?.assessmentId]);
  const yes = result?.justified;
  const pct = result ? Math.round(result.confidenceScore * 100) : 0;
  const long = result && result.reasoning.length > LONG_REASONING;

  return (
    <section className="card" aria-label="Assessment result" aria-live="polite">
      <h2 className="card-title">
        {result && !loading && <span className={`badge-icon ${yes ? 'ok' : 'bad'}`}>{yes ? <CheckIcon /> : <CrossIcon />}</span>}
        Assessment Result
      </h2>

      {loading && (
        <div role="status" className="loading">
          <span className="spinner" aria-hidden="true" />
          Analysing evidence… {elapsed}s <small>(times out after 30 s)</small>
        </div>
      )}
      {error && <p role="alert" className="error">{error}</p>}
      {!loading && !error && !result && (
        <p className="empty">No result yet. Submit a claim, or click the eye icon on a past claim.</p>
      )}

      {!loading && result && input && (
        <div className={`result ${yes ? 'is-yes' : 'is-no'}`}>
          <div className="result-top">
            <div>
              <div className={`verdict ${yes ? 'yes' : 'no'}`}>{yes ? 'Yes' : 'No'}</div>
              <p className="result-claim">{input.claimText}</p>
              <small className="muted">{input.productName}{input.market ? ` · ${input.market}` : ''}</small>
            </div>
            <div className={`ring ${yes ? 'ring-yes' : 'ring-no'}`} role="img" aria-label={`Confidence ${pct} percent`}>
              <svg viewBox="0 0 120 120" width="120" height="120">
                <circle className="ring-track" cx="60" cy="60" r={RING_R} />
                <circle className="ring-value" cx="60" cy="60" r={RING_R}
                        strokeDasharray={RING_C} strokeDashoffset={RING_C * (1 - gauge)} transform="rotate(-90 60 60)" />
              </svg>
              <div className="ring-text"><strong>{pct}%</strong><span>Confidence</span></div>
            </div>
          </div>
          <p className="muted note">Confidence is model self-reported and not calibrated.</p>

          {result.status === 'NEEDS_REVIEW' && (
            <p className="review">Flagged for human review (low confidence or not justified).</p>
          )}

          <h3 className="sub">Reasoning</h3>
          <p className={`reasoning${long && !expanded ? ' clamp' : ''}`}>{result.reasoning}</p>
          {long && (
            <button type="button" className="link" onClick={() => setExpanded(!expanded)}>
              {expanded ? 'Show less' : 'Read more'}
            </button>
          )}

          <div className="result-foot">
            <small className="muted">
              Model {result.model} · prompt {result.promptVersion} · {new Date(result.createdAt).toLocaleString()}
              <br />assessment {result.assessmentId}
            </small>
            <button type="button" className="outline" onClick={onCopy}><CopyIcon /> {copied ? 'Copied ✓' : 'Copy'}</button>
          </div>
        </div>
      )}
    </section>
  );
}

/* ---------- history card (table + pagination) ---------- */
function HistoryCard({ history, page, setPage, pageSize, setPageSize, loading, error, activeId, onView, onRefresh, busy }) {
  return (
    <section className="card history" aria-label="Claim history">
      <div className="history-head">
        <h2 className="card-title">Claim History <small>({history.total} {history.total === 1 ? 'assessment' : 'assessments'}, newest first)</small></h2>
        <button type="button" className="link" onClick={onRefresh}><RefreshIcon /> Refresh</button>
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      {!error && !loading && history.items.length === 0 ? (
        <p className="empty">No assessed claims yet. Submit a claim to see it here.</p>
      ) : (
        <div className={`table-wrap${loading ? ' is-loading' : ''}`}>
          <table>
            <thead>
              <tr><th>Claim</th><th>Product</th><th>Justified</th><th>Confidence</th><th>Status</th><th>Time</th><th aria-label="View" /></tr>
            </thead>
            <tbody>
              {history.items.map((item) => (
                <tr key={item.assessmentId} className={activeId === item.assessmentId ? 'active' : ''}>
                  <td className="cell-claim" title={item.claimText}>{item.claimText}</td>
                  <td>{item.productName}</td>
                  <td><span className={`pill ${item.justified ? 'pill-yes' : 'pill-no'}`}>{item.justified ? 'Yes' : 'No'}</span></td>
                  <td>{Math.round(item.confidenceScore * 100)}%</td>
                  <td><span className={`pill ${item.status === 'NEEDS_REVIEW' ? 'pill-warn' : 'pill-done'}`}>{item.status === 'NEEDS_REVIEW' ? 'Needs review' : 'Completed'}</span></td>
                  <td>{new Date(item.createdAt).toLocaleString()}</td>
                  <td>
                    <button type="button" className="icon-btn" onClick={() => onView(item)} disabled={busy}
                            aria-label={`View assessment for ${item.claimText}`} title="View assessment"><EyeIcon /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <nav className="pager" aria-label="History pagination">
        <label className="page-size">
          Rows per page
          <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <span className="muted">Page {history.page ?? page} of {history.totalPages}</span>
        <button type="button" className="outline" onClick={() => setPage((p) => p - 1)} disabled={page <= 1 || loading}>Previous</button>
        <button type="button" className="outline" onClick={() => setPage((p) => p + 1)} disabled={page >= history.totalPages || loading}>Next</button>
      </nav>
    </section>
  );
}

export default function ClaimAssessment() {
  const [tab, setTab] = useState('new'); // 'new' | 'history'
  const [step, setStep] = useState('edit'); // 'edit' | 'review'
  const [submitted, setSubmitted] = useState(false); // true once the shown review produced a result
  const [form, setForm] = useState(EMPTY);
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [resultInput, setResultInput] = useState(null); // the claim the shown result belongs to
  const [copied, setCopied] = useState(false);
  const [gauge, setGauge] = useState(0); // 0..1, drives the ring animation
  const abortRef = useRef(null);
  const cancelledRef = useRef(false);

  // History comes from the database through GET /api/claims, one page at a time.
  const [history, setHistory] = useState({ items: [], total: 0, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [reloadKey, setReloadKey] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState(null);

  const update = (field) => (e) => { setForm({ ...form, [field]: e.target.value }); setSubmitted(false); };
  const claimOk = Boolean(form.claimText.trim() && form.productName.trim());
  const evidenceOk = Boolean(form.evidence.trim());
  const canNext = claimOk && evidenceOk && !loading;

  // Elapsed-seconds counter while a request is running.
  useEffect(() => {
    if (!loading) return undefined;
    setElapsed(0);
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [loading]);

  // Load the current history page whenever page, page size or reloadKey changes.
  useEffect(() => {
    let stale = false;
    setHistoryLoading(true);
    setHistoryError(null);
    fetch(`${HISTORY_URL}?page=${page}&pageSize=${pageSize}`)
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(Array.isArray(data?.message) ? data.message.join('; ') : data?.message || `Request failed (${res.status})`);
        return data;
      })
      .then((data) => {
        if (stale) return;
        // If the last page disappeared (e.g. page size changed), step back to the last real page.
        if (data.items.length === 0 && data.page > data.totalPages) setPage(data.totalPages);
        else setHistory(data);
      })
      .catch((err) => { if (!stale) setHistoryError(`Could not load history: ${err.message}`); })
      .finally(() => { if (!stale) setHistoryLoading(false); });
    return () => { stale = true; };
  }, [page, pageSize, reloadKey]);

  // Animate the confidence ring from 0 to its value whenever a result is shown.
  useEffect(() => {
    setGauge(0);
    if (!result) return undefined;
    const id = requestAnimationFrame(() => setGauge(result.confidenceScore));
    return () => cancelAnimationFrame(id);
  }, [result]);

  async function submit() {
    if (!canNext) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setCopied(false);
    setSubmitted(false);
    cancelledRef.current = false;

    // Send only fields the backend accepts; omit empty optional market.
    const body = {
      claimText: form.claimText.trim(),
      productName: form.productName.trim(),
      evidence: form.evidence.trim(),
    };
    if (form.market.trim()) body.market = form.market.trim();

    const controller = new AbortController();
    abortRef.current = controller;
    const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = Array.isArray(data?.message) ? data.message.join('; ') : data?.message;
        throw new Error(msg || `Request failed (${res.status})`);
      }
      setResult(data);
      setResultInput({ claimText: body.claimText, productName: body.productName, market: body.market });
      setSubmitted(true); // stay on the Review step, all steps done
      setPage(1); // the new assessment is newest, so show page 1
      setReloadKey((k) => k + 1);
    } catch (err) {
      if (err.name === 'AbortError') {
        setError(cancelledRef.current ? 'Assessment cancelled.' : 'The request timed out. Please try again.');
      } else {
        setError(err.message);
      }
    } finally {
      clearTimeout(timer);
      abortRef.current = null;
      setLoading(false);
    }
  }

  // Ctrl/Cmd + Enter: go to the review step, or submit when already reviewing.
  function handleKeyDown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (step === 'review') submit();
      else if (canNext) setStep('review');
    }
  }

  function cancel() {
    cancelledRef.current = true;
    abortRef.current?.abort();
  }

  function fill(values) {
    setForm(values);
    setSubmitted(false);
    setStep('edit');
    setResult(null);
    setError(null);
  }

  function reset() {
    setForm(EMPTY);
    setSubmitted(false);
    setStep('edit');
    setResult(null);
    setError(null);
  }

  // View a past assessment in the result card without touching the form.
  // A history item carries the same fields as the POST response, plus the claim.
  function view(item) {
    setResult(item);
    setResultInput({ claimText: item.claimText, productName: item.productName, ...(item.market ? { market: item.market } : {}) });
    setError(null);
    setCopied(false);
  }

  async function copyResult() {
    const r = result;
    const text =
      `Claim: ${resultInput.claimText}\nProduct: ${resultInput.productName}\nJustified: ${r.justified ? 'Yes' : 'No'}\n` +
      `Confidence: ${Math.round(r.confidenceScore * 100)}% (self-reported)\nStatus: ${r.status}\n` +
      `Reasoning: ${r.reasoning}\nModel: ${r.model}, prompt ${r.promptVersion}, assessment ${r.assessmentId}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy to clipboard.');
    }
  }

  const counter = (field) => (
    <small className={form[field].length > LIMITS[field] * 0.9 ? 'count warn' : 'count'}>
      {form[field].length.toLocaleString()} / {LIMITS[field].toLocaleString()}
    </small>
  );

  // Stepper state is derived from what the user has filled in.
  const steps = step === 'review'
    ? [{ label: 'Claim', state: 'done' }, { label: 'Evidence', state: 'done' }, { label: 'Review', state: submitted ? 'done' : 'active' }]
    : [
        { label: 'Claim', state: claimOk ? 'done' : 'active' },
        { label: 'Evidence', state: !claimOk ? 'todo' : evidenceOk ? 'done' : 'active' },
        { label: 'Review', state: 'todo' },
      ];

  const resultCard = (
    <ResultCard result={result} input={resultInput} loading={loading} elapsed={elapsed} error={error}
                gauge={gauge} copied={copied} onCopy={copyResult} />
  );
  const historyCard = (
    <HistoryCard history={history} page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize}
                 loading={historyLoading} error={historyError} activeId={result?.assessmentId} onView={view}
                 onRefresh={() => setReloadKey((k) => k + 1)} busy={loading} />
  );

  const formCard = (
    <section className="card" aria-label="Claim inputs">
      <Stepper steps={steps} />
      <h2 className="card-title">{step === 'review' ? 'Review and assess' : 'Claim and Evidence'}</h2>

      {step === 'edit' ? (
        <>
          <div className="examples">
            <span>Try an example:</span>
            {EXAMPLES.map((ex) => (
              <button key={ex.label} type="button" className="chip" onClick={() => fill(ex.values)} disabled={loading}>{ex.label}</button>
            ))}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); if (canNext) setStep('review'); }}>
            <label>
              <span className="label-row">Claim {counter('claimText')}</span>
              <input value={form.claimText} onChange={update('claimText')} maxLength={LIMITS.claimText} required
                     placeholder="Reduces wrinkles by 20% in 4 weeks" />
            </label>
            <div className="row">
              <label>
                <span className="label-row">Product name {counter('productName')}</span>
                <input value={form.productName} onChange={update('productName')} maxLength={LIMITS.productName} required />
              </label>
              <label>
                <span className="label-row">Market (optional)</span>
                <input value={form.market} onChange={update('market')} maxLength={LIMITS.market} placeholder="EU" />
              </label>
            </div>
            <label>
              <span className="label-row">Evidence (clinical study results) {counter('evidence')}</span>
              <textarea value={form.evidence} onChange={update('evidence')} maxLength={LIMITS.evidence} rows={6} required
                        placeholder="Paste study design, sample size, duration, endpoint, results, statistics…" />
            </label>
            <div className="actions">
              <button type="submit" disabled={!canNext}>Next: Review →</button>
              {(form.claimText || form.productName || form.evidence || form.market) && (
                <button type="button" className="outline" onClick={reset}>Clear</button>
              )}
              <small className="shortcut">Ctrl + Enter to continue</small>
            </div>
          </form>
        </>
      ) : (
        <>
          <dl className="summary">
            <dt>Claim</dt><dd>{form.claimText}</dd>
            <dt>Product</dt><dd>{form.productName}{form.market ? ` · ${form.market}` : ''}</dd>
            <dt>Evidence</dt><dd className="summary-evidence">{form.evidence}</dd>
          </dl>
          <div className="actions">
            <button type="button" onClick={submit} disabled={loading}>
              {loading ? 'Assessing…' : submitted ? 'Assess again' : 'Assess claim'}
            </button>
            {loading
              ? <button type="button" className="outline" onClick={cancel}>Cancel</button>
              : <button type="button" className="outline" onClick={() => setStep('edit')}>← {submitted ? 'Edit' : 'Back'}</button>}
            {submitted && !loading && <button type="button" className="outline" onClick={reset}>New assessment</button>}
            <small className="shortcut">Ctrl + Enter to submit</small>
          </div>
        </>
      )}
      <p className="muted note">An AI opinion on whether the evidence supports the claim. It supports, and does not replace, expert review.</p>
    </section>
  );

  return (
    <div className="app" onKeyDown={handleKeyDown}>
      <header className="topbar">
        <div className="brand"><span className="brand-mark"><ShieldIcon /></span> Claim Assessment</div>
        <nav className="tabs" aria-label="Views">
          <button type="button" className={tab === 'new' ? 'tab on' : 'tab'} onClick={() => setTab('new')}>New Assessment</button>
          <button type="button" className={tab === 'history' ? 'tab on' : 'tab'} onClick={() => setTab('history')}>History</button>
        </nav>
      </header>

      <main className="container">
        {tab === 'new' ? (
          <>
            <div className="layout">{formCard}{resultCard}</div>
            {historyCard}
          </>
        ) : (
          <div className="layout layout-history">{historyCard}{resultCard}</div>
        )}
      </main>
    </div>
  );
}
