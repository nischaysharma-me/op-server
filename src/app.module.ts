import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AppInfoModule } from './modules/app-info/app-info.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { IssuesModule } from './modules/issues/issues.module';
import { PollsModule } from './modules/polls/polls.module';
import { AgentsModule } from './modules/agents/agents.module';
import { CrossQuestionsModule } from './modules/cross-questions/cross-questions.module';
import { OpinionsModule } from './modules/opinions/opinions.module';
import { CommentsModule } from './modules/comments/comments.module';
import { ReactionsModule } from './modules/reactions/reactions.module';
import { ModelsModule } from './modules/models/models.module';
import { SparringModule } from './modules/sparring/sparring.module';
import { OrganismsModule } from './modules/organisms/organisms.module';
import { MessagesModule } from './modules/messages/messages.module';
import { VectorModule } from './modules/vector/vector.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri:
          configService.get<string>('DATABASE_URL') ||
          'mongodb://127.0.0.1:27017/opinions_poll',
      }),
    }),
    VectorModule,
    AppInfoModule,
    AuthModule,
    UsersModule,
    IssuesModule,
    PollsModule,
    AgentsModule,
    CrossQuestionsModule,
    OpinionsModule,
    CommentsModule,
    ReactionsModule,
    ModelsModule,
    SparringModule,
    OrganismsModule,
    MessagesModule,
  ],
})
export class AppModule {}
