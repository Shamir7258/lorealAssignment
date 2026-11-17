import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ClaimsService } from './claims.service';
import { AssessClaimDto, AssessClaimResponse, ClaimHistoryResponse, ListClaimsQueryDto } from './dto/assess-claim.dto';

@Controller('claims')
export class ClaimsController {
  constructor(private readonly claims: ClaimsService) {}

  /** POST /api/claims/assess (the "api" prefix is set in main.ts). */
  @Post('assess')
  @HttpCode(201)
  assess(@Body() dto: AssessClaimDto): Promise<AssessClaimResponse> {
    return this.claims.assess(dto);
  }

  /** GET /api/claims?page=1&pageSize=10: paginated history of assessed claims, newest first. */
  @Get()
  history(@Query() query: ListClaimsQueryDto): Promise<ClaimHistoryResponse> {
    return this.claims.history(query.page, query.pageSize);
  }
}
