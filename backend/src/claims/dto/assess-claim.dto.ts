import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** Request body of POST /api/claims/assess. */
export class AssessClaimDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  claimText: string; // e.g. "Reduces wrinkles by 20% in 4 weeks"

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  productName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20000) // bounds LLM cost and prompt-injection surface
  evidence: string; // evaluator's clinical study results as text

  @IsOptional()
  @IsString()
  @MaxLength(100)
  market?: string; // e.g. "EU"
}

/**
 * Response body of POST /api/claims/assess (HTTP 201).
 * The React component relies on exactly these field names.
 */
export interface AssessClaimResponse {
  assessmentId: string;
  claimId: string;
  status: 'COMPLETED' | 'NEEDS_REVIEW';
  justified: boolean;
  confidenceScore: number; // 0..1, self-reported by the model, not calibrated
  reasoning: string;
  model: string;
  promptVersion: string;
  createdAt: string; // ISO 8601
}

/** Query string of GET /api/claims, for example ?page=2&pageSize=10. */
export class ListClaimsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize: number = 10;
}

/** One row of the history: the POST response fields plus the claim they belong to. */
export interface ClaimHistoryItem extends AssessClaimResponse {
  claimText: string;
  productName: string;
  market: string | null;
}

/**
 * Response body of GET /api/claims (HTTP 200).
 * Newest first. Only assessments with a verdict (COMPLETED, NEEDS_REVIEW) are listed;
 * FAILED and PENDING ones are not. Evidence text is not returned.
 */
export interface ClaimHistoryResponse {
  items: ClaimHistoryItem[];
  total: number; // all matching assessments
  page: number; // 1-based
  pageSize: number;
  totalPages: number; // at least 1
}
