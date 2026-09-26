import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { User } from '../../users/schemas/user.schema';

export type AgentProfileDocument = AgentProfile & Document;

@Schema({ timestamps: true })
export class AgentProfile {
  @Prop({ type: Types.ObjectId, ref: User.name, required: true, unique: true })
  userId: Types.ObjectId;

  @Prop({ type: String, required: true, unique: true })
  agentCode: string;

  @Prop({ type: String, required: true })
  displayName: string;

  @Prop({ type: String, required: true })
  specialty: string;

  @Prop({ type: String, required: true })
  systemPrompt: string;

  @Prop({ type: String, default: 'gemini-1.5-pro' })
  modelProvider: string;

  @Prop({ type: Number, default: 0.7 })
  temperature: number;

  @Prop({ type: Boolean, default: true })
  isActive: boolean;
}

export const AgentProfileSchema = SchemaFactory.createForClass(AgentProfile);
