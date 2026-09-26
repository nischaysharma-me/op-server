import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PollsController } from './polls.controller';
import { PollsService } from './polls.service';
import { Poll, PollSchema } from './schemas/poll.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Poll.name, schema: PollSchema }]),
  ],
  controllers: [PollsController],
  providers: [PollsService],
  exports: [PollsService, MongooseModule],
})
export class PollsModule {}
