import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PollDocument = Poll & Document;

@Schema({ _id: false })
export class PollOpinionItem {
  @Prop({ type: String })
  userId: string;

  @Prop({ type: String })
  opinion: string;
}

export const PollOpinionItemSchema = SchemaFactory.createForClass(PollOpinionItem);

@Schema({ timestamps: true })
export class Poll {
  @Prop({ type: String })
  issueId: string;

  @Prop({ type: String })
  opinion: string;

  @Prop({ type: [PollOpinionItemSchema], default: [] })
  opinions: PollOpinionItem[];
}

export const PollSchema = SchemaFactory.createForClass(Poll);
