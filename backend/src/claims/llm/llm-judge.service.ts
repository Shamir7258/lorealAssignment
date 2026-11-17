import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { buildUserPrompt, PROMPT_VERSION, SYSTEM_PROMPT, VERDICT_SCHEMA } from './prompt';

export interface Verdict {
  justified: boolean;
  confidence: number;
  reasoning: string;
}

/** Failure kinds the service maps to HTTP status codes. */
export class LlmError extends Error {
  constructor(public readonly kind: 'TIMEOUT' | 'UPSTREAM' | 'INVALID_OUTPUT', message: string) {
    super(message);
  }
}

@Injectable()
export class LlmJudgeService {
  private readonly logger = new Logger(LlmJudgeService.name);
  private readonly client?: OpenAI; // undefined in mock mode
  readonly isMock: boolean;
  readonly model: string;
  readonly promptVersion = PROMPT_VERSION;

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('OPENAI_API_KEY')?.trim(); // never hardcoded
    this.isMock = !apiKey;
    if (this.isMock) {
      // Demo mode: no key, so no real model is called. Verdicts are rule-based and labelled [MOCK].
      this.model = 'mock-llm';
      this.logger.warn('OPENAI_API_KEY is not set: using the MOCK LLM provider. Verdicts are NOT real AI judgements.');
    } else {
      this.model = config.getOrThrow<string>('OPENAI_MODEL');
      this.client = new OpenAI({
        apiKey,
        timeout: Number(config.get('OPENAI_TIMEOUT_MS') ?? 30000),
        maxRetries: 1, // one retry on transient errors (connection, 429, 5xx)
      });
    }
  }

  /**
   * Deterministic stand-in for the LLM. Justified only if the evidence reports a percentage change
   * at least as large as the claimed one AND a significance statistic (p <= 0.05). Crude on purpose.
   */
  mockJudge(claimText: string, evidence: string): Verdict {
    const claimPct = Number(/(\d+(?:\.\d+)?)\s*%/.exec(claimText)?.[1]);
    const evidencePcts = [...evidence.matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map((m) => Number(m[1]));
    const best = evidencePcts.length ? Math.max(...evidencePcts) : NaN;
    const significant = /p\s*(<|<=|=)\s*0?\.0(?:[0-4]\d*|5)\b/i.test(evidence);
    if (Number.isNaN(claimPct) || Number.isNaN(best)) {
      return { justified: false, confidence: 0.3, reasoning: '[MOCK] Could not find a percentage in both the claim and the evidence, so support cannot be established.' };
    }
    const justified = best >= claimPct && significant;
    return {
      justified,
      confidence: justified ? 0.85 : 0.6,
      reasoning: `[MOCK] Claim states ${claimPct}%; the largest effect found in the evidence is ${best}%; ` +
        `${significant ? 'a significant p-value (p <= 0.05) is reported' : 'no significant p-value was found'}. ` +
        'This is a rule-based demo result, not an AI judgement.',
    };
  }

  async judge(claimText: string, productName: string, market: string | undefined, evidence: string): Promise<Verdict> {
    if (this.isMock || !this.client) return this.mockJudge(claimText, evidence);
    let content: string | null | undefined;
    try {
      const res = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(claimText, productName, market, evidence) },
        ],
        response_format: { type: 'json_schema', json_schema: VERDICT_SCHEMA },
      });
      const choice = res.choices[0];
      if (choice?.message?.refusal) throw new LlmError('INVALID_OUTPUT', 'Model refused to answer');
      content = choice?.message?.content;
    } catch (err) {
      if (err instanceof LlmError) throw err;
      if (err instanceof OpenAI.APIConnectionTimeoutError) throw new LlmError('TIMEOUT', 'LLM request timed out');
      this.logger.error(`OpenAI call failed: ${(err as Error).message}`);
      throw new LlmError('UPSTREAM', 'LLM provider request failed');
    }
    return this.parseVerdict(content);
  }

  /** Structured outputs should already guarantee the shape; validate anyway (defence in depth). */
  parseVerdict(content: string | null | undefined): Verdict {
    if (!content) throw new LlmError('INVALID_OUTPUT', 'Empty LLM response');
    let data: unknown;
    try {
      data = JSON.parse(content);
    } catch {
      throw new LlmError('INVALID_OUTPUT', 'LLM returned invalid JSON');
    }
    const v = data as Partial<Verdict>;
    const ok =
      typeof v?.justified === 'boolean' &&
      typeof v.confidence === 'number' && Number.isFinite(v.confidence) &&
      v.confidence >= 0 && v.confidence <= 1 &&
      typeof v.reasoning === 'string' && v.reasoning.trim().length > 0;
    if (!ok) throw new LlmError('INVALID_OUTPUT', 'LLM JSON did not match the expected schema');
    return { justified: v.justified!, confidence: v.confidence!, reasoning: v.reasoning!.trim() };
  }
}
