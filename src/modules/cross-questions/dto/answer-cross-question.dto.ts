import { IsNotEmpty, IsString } from 'class-validator';

export class AnswerCrossQuestionDto {
  @IsString()
  @IsNotEmpty()
  answerText: string;

  @IsString()
  @IsNotEmpty()
  userId: string;
}
