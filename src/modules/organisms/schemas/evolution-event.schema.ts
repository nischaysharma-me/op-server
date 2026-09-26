import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type EvolutionEventDocument = EvolutionEvent & Document;

export enum EvolutionEventType {
  ORGANISM_BORN = 'ORGANISM_BORN',
  MATURITY_REACHED = 'MATURITY_REACHED',
  GENETIC_MUTATION = 'GENETIC_MUTATION',
  OFFSPRING_SPAWNED = 'OFFSPRING_SPAWNED',
  ORGANISM_RETIRED = 'ORGANISM_RETIRED',
  FITNESS_SPIKE = 'FITNESS_SPIKE',
}

@Schema({ timestamps: true })
export class EvolutionEvent {
  @Prop({ type: String, enum: EvolutionEventType, required: true, index: true })
  eventType: EvolutionEventType;

  @Prop({ type: Number, required: true })
  generation: number;

  @Prop({ type: String, required: true, index: true })
  primaryOrganismCode: string;

  @Prop({ type: String, required: true })
  primaryOrganismName: string;

  @Prop({ type: String })
  secondaryOrganismCode?: string;

  @Prop({ type: String })
  secondaryOrganismName?: string;

  @Prop({ type: String })
  offspringCode?: string;

  @Prop({ type: String })
  offspringName?: string;

  @Prop({ type: String, required: true })
  title: string;

  @Prop({ type: String, required: true })
  description: string;

  @Prop({ type: MongooseSchema.Types.Mixed })
  genomeDelta?: Record<string, any>;

  @Prop({ type: Date, default: Date.now, index: true })
  timestamp: Date;
}

export const EvolutionEventSchema = SchemaFactory.createForClass(EvolutionEvent);
