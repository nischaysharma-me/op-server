import { IsOptional, IsString } from 'class-validator';

export class UpdateIssueDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  content?: string;

  @IsString()
  @IsOptional()
  creator?: string;
}
