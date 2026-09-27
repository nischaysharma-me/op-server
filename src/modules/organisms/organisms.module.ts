import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Organism, OrganismSchema } from './schemas/organism.schema';
import { EvolutionEvent, EvolutionEventSchema } from './schemas/evolution-event.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { Opinion, OpinionSchema } from '../opinions/schemas/opinion.schema';
import { Comment, CommentSchema } from '../comments/schemas/comment.schema';
import { EvolutionService } from './evolution.service';
import { OrganismsController } from './organisms.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Organism.name, schema: OrganismSchema },
      { name: EvolutionEvent.name, schema: EvolutionEventSchema },
      { name: User.name, schema: UserSchema },
      { name: Opinion.name, schema: OpinionSchema },
      { name: Comment.name, schema: CommentSchema },
    ]),
  ],
  controllers: [OrganismsController],
  providers: [EvolutionService],
  exports: [EvolutionService],
})
export class OrganismsModule {}
