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
  private readonly client: OpenAI;
  readonly model: string;
  readonly promptVersion = PROMPT_VERSION;

  constructor(config: ConfigService) {
    const apiKey = config.getOrThrow<string>('OPENAI_API_KEY'); // fail fast, never hardcode
    this.model = config.getOrThrow<string>('OPENAI_MODEL');
    this.client = new OpenAI({
      apiKey,
      timeout: Number(config.get('OPENAI_TIMEOUT_MS') ?? 30000),
      maxRetries: 1, // one retry on transient errors (connection, 429, 5xx)
    });
  }

  async judge(claimText: string, productName: string, market: string | undefined, evidence: string): Promise<Verdict> {
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
