import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type IssueDocument = Issue & Document;

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
  @Prop({ type: String })
  title: string;

  @Prop({ type: String })
  content: string;

  @Prop({ type: String })
  creator: string;

  @Prop({ type: [OpinionItemSchema], default: [] })
  opinions: OpinionItem[];
}

export const IssueSchema = SchemaFactory.createForClass(Issue);
