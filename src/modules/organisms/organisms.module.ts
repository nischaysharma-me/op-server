import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Organism, OrganismSchema } from './schemas/organism.schema';
import { EvolutionEvent, EvolutionEventSchema } from './schemas/evolution-event.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { EvolutionService } from './evolution.service';
import { OrganismsController } from './organisms.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Organism.name, schema: OrganismSchema },
      { name: EvolutionEvent.name, schema: EvolutionEventSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [OrganismsController],
  providers: [EvolutionService],
  exports: [EvolutionService],
})
export class OrganismsModule {}
