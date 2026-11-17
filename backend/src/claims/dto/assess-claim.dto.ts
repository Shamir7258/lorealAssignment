import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

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
