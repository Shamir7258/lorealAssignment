import { Module } from '@nestjs/common';
import { ClaimsController } from './claims.controller';
import { ClaimsService } from './claims.service';
import { LlmJudgeService } from './llm/llm-judge.service';

@Module({ controllers: [ClaimsController], providers: [ClaimsService, LlmJudgeService] })
export class ClaimsModule {}
