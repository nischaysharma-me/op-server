import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type MessageDocument = Message & Document;

@Schema({ timestamps: true })
export class Message {
  @Prop({ type: String, required: true, index: true })
  conversationId: string;

  @Prop({ type: String, required: true, index: true })
  senderId: string;

  @Prop({ type: String, default: 'USER' })
  senderType: string;

  @Prop({ type: String, default: '' })
  senderName: string;

  @Prop({ type: String, default: '' })
  senderAvatar: string;

  @Prop({ type: String, required: true, index: true })
  recipientId: string;

  @Prop({ type: String, default: 'USER' })
  recipientType: string;

  @Prop({ type: String, default: '' })
  recipientName: string;

  @Prop({ type: String, default: '' })
  recipientAvatar: string;

  @Prop({ type: String, required: true })
  content: string;

  @Prop({ type: Boolean, default: false })
  isRead: boolean;
}

export const MessageSchema = SchemaFactory.createForClass(Message);
MessageSchema.index({ conversationId: 1, createdAt: 1 });
