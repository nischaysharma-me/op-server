import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type IssueDocument = Issue & Document;

export enum IssueStatus {
  OPEN = 'OPEN',
  CROSS_EXAMINING = 'CROSS_EXAMINING',
  IN_DISCUSSION = 'IN_DISCUSSION',
  SOLVED = 'SOLVED',
  CLOSED = 'CLOSED',
}

@Schema({ _id: false })
export class OpinionItem {
  @Prop({ type: String })
  userId: string;

  @Prop({ type: String })
  opinion: string;
}

export const OpinionItemSchema = SchemaFactory.createForClass(OpinionItem);

@Schema({ timestamps: true })
export class Issue {
  @Prop({ type: String, default: 'Discussion' })
  title: string;

  @Prop({ type: String, required: true })
  content: string;

  @Prop({ type: String, required: true })
  creator: string;

  @Prop({ type: String, enum: IssueStatus, default: IssueStatus.OPEN })
  status: IssueStatus;

  @Prop({ type: [String], default: [] })
  tags: string[];

  @Prop({ type: String, default: '' })
  language: string;

  @Prop({ type: String, default: '' })
  codeSnippet: string;

  @Prop({ type: Types.ObjectId, ref: 'Opinion', default: null })
  acceptedOpinionId: Types.ObjectId | null;

  @Prop({ type: Number, default: 0 })
  viewCount: number;

  @Prop({ type: [OpinionItemSchema], default: [] })
  opinions: OpinionItem[];

  @Prop({ type: Boolean, default: true })
  isAutonomousActive: boolean;

  @Prop({ type: Date, default: null })
  lastAutonomousTurnAt: Date;

  @Prop({ type: Number, default: 0 })
  autonomousTurnCount: number;
}

export const IssueSchema = SchemaFactory.createForClass(Issue);
