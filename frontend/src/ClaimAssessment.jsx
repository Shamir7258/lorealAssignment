import { useEffect, useRef, useState } from 'react';

/*
 * API contract (matches backend/src/claims/dto/assess-claim.dto.ts)
 * Request  POST /api/claims/assess
 *   { claimText, productName, evidence, market? }
 * Response 201
 *   { assessmentId, claimId, status: "COMPLETED" | "NEEDS_REVIEW", justified,
 *     confidenceScore, reasoning, model, promptVersion, createdAt }
 * Error body: { statusCode, message }  (message is a string[] for validation errors)
 */
const API_URL = '/api/claims/assess';
const CLIENT_TIMEOUT_MS = 45000; // slightly above the server's 30 s LLM timeout
const LIMITS = { claimText: 500, productName: 200, market: 100, evidence: 20000 };
const HISTORY_MAX = 5;

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

// Confidence colour band: red < 50%, amber < 75%, green otherwise.
const band = (score) => (score < 0.5 ? 'low' : score < 0.75 ? 'mid' : 'high');

export default function ClaimAssessment() {
  const [form, setForm] = useState(EMPTY);
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]); // this session only, newest first
  const [copied, setCopied] = useState(false);
  const [gauge, setGauge] = useState(0); // drives the bar animation
  const abortRef = useRef(null);
  const cancelledRef = useRef(false);

  const update = (field) => (e) => setForm({ ...form, [field]: e.target.value });
  const canSubmit = !loading && form.claimText.trim() && form.productName.trim() && form.evidence.trim();

  // Elapsed-seconds counter while a request is running.
  useEffect(() => {
    if (!loading) return undefined;
    setElapsed(0);
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [loading]);

  // Animate the confidence bar from 0 to its value whenever a result is shown.
  useEffect(() => {
    setGauge(0);
    if (!result) return undefined;
    const id = requestAnimationFrame(() => setGauge(result.confidenceScore));
    return () => cancelAnimationFrame(id);
  }, [result]);

  async function submit() {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setCopied(false);
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
      setHistory((h) => [{ input: body, result: data }, ...h].slice(0, HISTORY_MAX));
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

  function handleSubmit(e) {
    e.preventDefault();
    submit();
  }

  // Ctrl/Cmd + Enter submits from any field.
  function handleKeyDown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  }

  function cancel() {
    cancelledRef.current = true;
    abortRef.current?.abort();
  }

  function fill(values) {
    setForm(values);
    setResult(null);
    setError(null);
  }

  function reset() {
    setForm(EMPTY);
    setResult(null);
    setError(null);
  }

  function reopen(item) {
    setForm({ market: '', ...item.input });
    setResult(item.result);
    setError(null);
  }

  async function copyResult() {
    const r = result;
    const text =
      `Claim: ${form.claimText}\nJustified: ${r.justified ? 'Yes' : 'No'}\n` +
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

  return (
    <main className="container" onKeyDown={handleKeyDown}>
      <h1>Claim Assessment</h1>
      <p className="hint">
        An AI opinion on whether the study evidence supports the claim. It supports, and does not replace, expert review.
      </p>

      <div className="examples">
        <span>Try an example:</span>
        {EXAMPLES.map((ex) => (
          <button key={ex.label} type="button" className="chip" onClick={() => fill(ex.values)} disabled={loading}>
            {ex.label}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit}>
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
          <textarea value={form.evidence} onChange={update('evidence')} maxLength={LIMITS.evidence} rows={8} required
                    placeholder="Study design, sample size, duration, endpoint, results, statistics..." />
        </label>
        <div className="actions">
          <button type="submit" disabled={!canSubmit}>{loading ? 'Assessing…' : 'Assess claim'}</button>
          {loading && <button type="button" className="secondary" onClick={cancel}>Cancel</button>}
          {!loading && (form.claimText || form.productName || form.evidence || form.market) && (
            <button type="button" className="secondary" onClick={reset}>Clear</button>
          )}
          <small className="shortcut">Ctrl + Enter to submit</small>
        </div>
      </form>

      {loading && (
        <div role="status" className="loading">
          <span className="spinner" aria-hidden="true" />
          Analysing evidence… {elapsed}s <small>(times out after 30 s)</small>
        </div>
      )}
      {error && <p role="alert" className="error">{error}</p>}

      {result && (
        <section className={`result ${result.justified ? 'is-yes' : 'is-no'}`} aria-live="polite">
          <h2>
            Justified:{' '}
            <span className={result.justified ? 'yes' : 'no'}>{result.justified ? 'Yes' : 'No'}</span>
          </h2>
          <p>
            Confidence: <strong>{Math.round(result.confidenceScore * 100)}%</strong>{' '}
            <small>(model self-reported, not calibrated)</small>
          </p>
          <div className="bar" role="img" aria-label={`Confidence ${Math.round(result.confidenceScore * 100)} percent`}>
            <div className={band(result.confidenceScore)} style={{ width: `${gauge * 100}%` }} />
          </div>
          {result.status === 'NEEDS_REVIEW' && (
            <p className="review">Flagged for human review (low confidence or not justified).</p>
          )}
          <h3>Reasoning</h3>
          <p>{result.reasoning}</p>
          <div className="result-foot">
            <small>
              Model {result.model} · prompt {result.promptVersion} · assessment {result.assessmentId} ·{' '}
              {new Date(result.createdAt).toLocaleString()}
            </small>
            <button type="button" className="secondary" onClick={copyResult}>{copied ? 'Copied ✓' : 'Copy result'}</button>
          </div>
        </section>
      )}

      {history.length > 0 && (
        <section className="history">
          <h3>This session</h3>
          <ul>
            {history.map((item) => (
              <li key={item.result.assessmentId}>
                <button type="button" onClick={() => reopen(item)} disabled={loading}
                        className={result?.assessmentId === item.result.assessmentId ? 'active' : ''}>
                  <span className={item.result.justified ? 'dot yes-bg' : 'dot no-bg'} />
                  <span className="h-claim">{item.input.claimText}</span>
                  <span className="h-meta">
                    {item.result.justified ? 'Yes' : 'No'} · {Math.round(item.result.confidenceScore * 100)}%
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
