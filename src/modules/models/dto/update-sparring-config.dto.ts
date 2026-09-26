import { IsObject, IsOptional, IsArray, IsString } from 'class-validator';

export class UpdateSparringConfigDto {
  @IsOptional()
  @IsObject()
  agentModelMap?: Record<string, string>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  activeSparringModels?: string[];

  @IsOptional()
  @IsString()
  defaultModel?: string;
}
