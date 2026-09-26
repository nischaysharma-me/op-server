import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpdatePollDto {
  @IsString()
  @IsNotEmpty()
  opinion: string;

  @IsString()
  @IsNotEmpty()
  userId: string;
}
