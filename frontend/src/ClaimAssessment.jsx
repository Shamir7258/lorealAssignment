import { useState } from 'react';

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

const EMPTY = { claimText: '', productName: '', market: '', evidence: '' };

export default function ClaimAssessment() {
  const [form, setForm] = useState(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const update = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);

    // Send only fields the backend accepts; omit empty optional market.
    const body = {
      claimText: form.claimText.trim(),
      productName: form.productName.trim(),
      evidence: form.evidence.trim(),
    };
    if (form.market.trim()) body.market = form.market.trim();

    const controller = new AbortController();
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
    } catch (err) {
      setError(err.name === 'AbortError' ? 'The request timed out. Please try again.' : err.message);
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  }

  return (
    <main className="container">
      <h1>Claim Assessment</h1>
      <p className="hint">
        An AI opinion on whether the study evidence supports the claim. It supports, and does not replace, expert review.
      </p>

      <form onSubmit={handleSubmit}>
        <label>
          Claim
          <input value={form.claimText} onChange={update('claimText')} maxLength={500} required
                 placeholder="Reduces wrinkles by 20% in 4 weeks" />
        </label>
        <label>
          Product name
          <input value={form.productName} onChange={update('productName')} maxLength={200} required />
        </label>
        <label>
          Market (optional)
          <input value={form.market} onChange={update('market')} maxLength={100} placeholder="EU" />
        </label>
        <label>
          Evidence (clinical study results)
          <textarea value={form.evidence} onChange={update('evidence')} maxLength={20000} rows={8} required
                    placeholder="Study design, sample size, duration, endpoint, results, statistics..." />
        </label>
        <button type="submit" disabled={loading}>{loading ? 'Assessing…' : 'Assess claim'}</button>
      </form>

      {loading && <p role="status" className="loading">Analysing evidence, this can take up to 30 seconds…</p>}
      {error && <p role="alert" className="error">{error}</p>}

      {result && (
        <section className="result" aria-live="polite">
          <h2>
            Justified:{' '}
            <span className={result.justified ? 'yes' : 'no'}>{result.justified ? 'Yes' : 'No'}</span>
          </h2>
          <p>
            Confidence: <strong>{Math.round(result.confidenceScore * 100)}%</strong>{' '}
            <small>(model self-reported, not calibrated)</small>
          </p>
          <div className="bar"><div style={{ width: `${result.confidenceScore * 100}%` }} /></div>
          {result.status === 'NEEDS_REVIEW' && (
            <p className="review">Flagged for human review (low confidence or not justified).</p>
          )}
          <h3>Reasoning</h3>
          <p>{result.reasoning}</p>
          <small>
            Model {result.model} · prompt {result.promptVersion} · assessment {result.assessmentId} ·{' '}
            {new Date(result.createdAt).toLocaleString()}
          </small>
        </section>
      )}
    </main>
  );
}
