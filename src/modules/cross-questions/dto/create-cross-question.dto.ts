import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateCrossQuestionDto {
  @IsString()
  @IsNotEmpty()
  issueId: string;

  @IsString()
  @IsNotEmpty()
  authorId: string;

  @IsString()
  @IsOptional()
  authorType?: string;

  @IsString()
  @IsOptional()
  agentCode?: string;

  @IsString()
  @IsNotEmpty()
  questionText: string;

  @IsString()
  @IsOptional()
  codeContext?: string;
}
