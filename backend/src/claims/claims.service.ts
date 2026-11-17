import { BadGatewayException, GatewayTimeoutException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AssessClaimDto, AssessClaimResponse, ClaimHistoryResponse } from './dto/assess-claim.dto';
import { LlmError, LlmJudgeService } from './llm/llm-judge.service';

@Injectable()
export class ClaimsService {
  private readonly threshold: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly judge: LlmJudgeService,
    config: ConfigService,
  ) {
    this.threshold = Number(config.get('REVIEW_CONFIDENCE_THRESHOLD') ?? 0.7);
  }

  async assess(dto: AssessClaimDto): Promise<AssessClaimResponse> {
    // 1. Persist the claim and a PENDING assessment first, so failures are auditable.
    const claim = await this.prisma.claim.create({
      data: { text: dto.claimText, productName: dto.productName, market: dto.market },
    });
    const pending = await this.prisma.assessment.create({
      data: {
        claimId: claim.id,
        evidence: dto.evidence,
        model: this.judge.model,
        promptVersion: this.judge.promptVersion,
      },
    });

    // 2. Ask the LLM.
    try {
      const verdict = await this.judge.judge(dto.claimText, dto.productName, dto.market, dto.evidence);
      // Human-in-the-loop: low confidence or "not justified" goes to a reviewer.
      const status = !verdict.justified || verdict.confidence < this.threshold ? 'NEEDS_REVIEW' : 'COMPLETED';
      const saved = await this.prisma.assessment.update({
        where: { id: pending.id },
        data: {
          status,
          justified: verdict.justified,
          confidenceScore: verdict.confidence,
          reasoning: verdict.reasoning,
        },
      });
      return {
        assessmentId: saved.id,
        claimId: saved.claimId,
        status,
        justified: verdict.justified,
        confidenceScore: verdict.confidence,
        reasoning: verdict.reasoning,
        model: saved.model,
        promptVersion: saved.promptVersion,
        createdAt: saved.createdAt.toISOString(),
      };
    } catch (err) {
      // 3. Record the failure, then surface a clean HTTP error (no provider internals leaked).
      const message = err instanceof LlmError ? err.message : 'Unexpected error';
      await this.prisma.assessment.update({
        where: { id: pending.id },
        data: { status: 'FAILED', errorMessage: message },
      });
      if (err instanceof LlmError && err.kind === 'TIMEOUT') {
        throw new GatewayTimeoutException('The AI assessment timed out. Please try again.');
      }
      throw new BadGatewayException('The AI assessment failed. Please try again or request manual review.');
    }
  }

  /** Paginated history, newest first, limited to assessments that have a verdict. */
  async history(page: number, pageSize: number): Promise<ClaimHistoryResponse> {
    const where = { status: { in: ['COMPLETED', 'NEEDS_REVIEW'] as ('COMPLETED' | 'NEEDS_REVIEW')[] } };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.assessment.count({ where }),
      this.prisma.assessment.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], // id breaks ties so pages are stable
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { claim: true },
      }),
    ]);
    return {
      items: rows.map((a) => ({
        assessmentId: a.id,
        claimId: a.claimId,
        claimText: a.claim.text,
        productName: a.claim.productName,
        market: a.claim.market,
        status: a.status as 'COMPLETED' | 'NEEDS_REVIEW',
        justified: a.justified as boolean,
        confidenceScore: a.confidenceScore as number,
        reasoning: a.reasoning as string,
        model: a.model,
        promptVersion: a.promptVersion,
        createdAt: a.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }
}
