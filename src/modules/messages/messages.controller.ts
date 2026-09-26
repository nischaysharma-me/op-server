import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { SendMessageDto } from './dto/send-message.dto';

@Controller('messages')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Get('conversations/:userId')
  getConversations(@Param('userId') userId: string) {
    return this.messagesService.getConversations(userId);
  }

  @Get('thread/:conversationId')
  getThread(
    @Param('conversationId') conversationId: string,
    @Query('limit') limit?: string,
  ) {
    return this.messagesService.getThread(
      conversationId,
      limit ? parseInt(limit, 10) : 50,
    );
  }

  @Post('send')
  sendMessage(@Body() dto: SendMessageDto) {
    return this.messagesService.sendMessage(dto);
  }

  @Put('read/:conversationId')
  markAsRead(
    @Param('conversationId') conversationId: string,
    @Body('userId') userId: string,
  ) {
    return this.messagesService.markAsRead(conversationId, userId);
  }
}
