import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ClaimsService } from './claims.service';
import { AssessClaimDto, AssessClaimResponse } from './dto/assess-claim.dto';

@Controller('claims')
export class ClaimsController {
  constructor(private readonly claims: ClaimsService) {}

  /** POST /api/claims/assess (the "api" prefix is set in main.ts). */
  @Post('assess')
  @HttpCode(201)
  assess(@Body() dto: AssessClaimDto): Promise<AssessClaimResponse> {
    return this.claims.assess(dto);
  }
}
