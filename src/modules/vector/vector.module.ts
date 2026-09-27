import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { VectorService } from './vector.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [VectorService],
  exports: [VectorService],
})
export class VectorModule {}
