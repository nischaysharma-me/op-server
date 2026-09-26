import { IsNotEmpty, IsString } from 'class-validator';

export class UpdateOpinionDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsString()
  @IsNotEmpty()
  opinion: string;
}
