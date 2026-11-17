import { BadGatewayException, GatewayTimeoutException } from '@nestjs/common';
import { ClaimsService } from '../src/claims/claims.service';
import { LlmError, LlmJudgeService } from '../src/claims/llm/llm-judge.service';

const dto = { claimText: 'Reduces wrinkles by 20% in 4 weeks', productName: 'Serum X', evidence: 'n=60, -22% at week 4, p<0.01' };

function setup(judgeImpl: () => Promise<any>) {
  const update = jest.fn(async ({ data }) => ({ id: 'a1', claimId: 'c1', model: 'm', promptVersion: 'v1', createdAt: new Date('2026-01-01'), ...data }));
  const prisma: any = {
    claim: { create: jest.fn(async () => ({ id: 'c1' })) },
    assessment: { create: jest.fn(async () => ({ id: 'a1' })), update },
  };
  const judge: any = { model: 'm', promptVersion: 'v1', judge: jest.fn(judgeImpl) };
  const config: any = { get: () => undefined };
  return { service: new ClaimsService(prisma, judge, config), update };
}

describe('ClaimsService.assess', () => {
  it('saves a confident justified verdict as COMPLETED', async () => {
    const { service } = setup(async () => ({ justified: true, confidence: 0.9, reasoning: 'ok' }));
    const res = await service.assess(dto);
    expect(res).toMatchObject({ status: 'COMPLETED', justified: true, confidenceScore: 0.9, claimId: 'c1', assessmentId: 'a1' });
  });
  it('routes low confidence to NEEDS_REVIEW', async () => {
    const { service } = setup(async () => ({ justified: true, confidence: 0.4, reasoning: 'unsure' }));
    expect((await service.assess(dto)).status).toBe('NEEDS_REVIEW');
  });
  it('maps timeout to 504 and marks FAILED', async () => {
    const { service, update } = setup(async () => { throw new LlmError('TIMEOUT', 'timed out'); });
    await expect(service.assess(dto)).rejects.toBeInstanceOf(GatewayTimeoutException);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }));
  });
  it('maps invalid output to 502', async () => {
    const { service } = setup(async () => { throw new LlmError('INVALID_OUTPUT', 'bad json'); });
    await expect(service.assess(dto)).rejects.toBeInstanceOf(BadGatewayException);
  });
});

describe('LlmJudgeService.parseVerdict', () => {
  const parse = (s: any) => LlmJudgeService.prototype.parseVerdict.call({}, s);
  it('accepts valid JSON', () => expect(parse('{"justified":false,"confidence":0.5,"reasoning":"r"}').justified).toBe(false));
  it('rejects non-JSON', () => expect(() => parse('nope')).toThrow('invalid JSON'));
  it('rejects out-of-range confidence', () => expect(() => parse('{"justified":true,"confidence":1.5,"reasoning":"r"}')).toThrow('schema'));
  it('rejects empty content', () => expect(() => parse(null)).toThrow('Empty'));
});

describe('LlmJudgeService mock mode (no OPENAI_API_KEY)', () => {
  const svc = new LlmJudgeService({ get: () => undefined, getOrThrow: () => { throw new Error('unused'); } } as any);
  it('is enabled and labelled', () => { expect(svc.isMock).toBe(true); expect(svc.model).toBe('mock-llm'); });
  it('justifies when evidence meets the claim and is significant', async () => {
    const v = await svc.judge('Reduces wrinkles by 20% in 4 weeks', 'Serum X', undefined, 'n=60, -22% at week 4, p<0.01');
    expect(v.justified).toBe(true);
  });
  it('rejects when effect is smaller than claimed', async () => {
    const v = await svc.judge('Reduces wrinkles by 20% in 4 weeks', 'Serum X', undefined, 'n=60, -8% at week 4, p<0.01');
    expect(v.justified).toBe(false);
  });
});
