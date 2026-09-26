import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateOpinionDto {
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
  @IsOptional()
  title?: string;

  @IsString()
  @IsNotEmpty()
  content: string;

  @IsString()
  @IsOptional()
  codeBlock?: string;

  @IsNumber()
  @IsOptional()
  confidenceScore?: number;
}
