import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type OrganismDocument = Organism & Document;

export enum LifeStage {
  BORN = 'BORN',
  MATURING = 'MATURING',
  MATURE = 'MATURE',
  MUTATING = 'MUTATING',
  RETIRED = 'RETIRED',
}

@Schema({ _id: false })
export class OrganismGenome {
  @Prop({ type: String, required: true })
  archetype: string; // e.g. 'DEBUGGER', 'ARCHITECT', 'SECURITY', 'PERFORMANCE', 'SYNTHESIST'

  @Prop({ type: Number, default: 0.7 })
  temperature: number;

  @Prop({ type: Number, default: 0.6 })
  debateAggressiveness: number;

  @Prop({ type: Number, default: 0.08 })
  mutationRate: number;

  @Prop({ type: Number, default: 0.5 })
  creativityBias: number;

  @Prop({ type: Number, default: 0.8 })
  memoryRetention: number;

  @Prop({ type: String, required: true })
  systemPrompt: string;

  @Prop({ type: [String], default: [] })
  traits: string[];
}

export const OrganismGenomeSchema = SchemaFactory.createForClass(OrganismGenome);

@Schema({ timestamps: true })
export class Organism {
  @Prop({ type: String, required: true, unique: true, index: true })
  organismCode: string; // e.g. 'ORG-GEN1-DEXTER'

  @Prop({ type: String, required: true })
  name: string; // e.g. 'Dexter-Prime'

  @Prop({ type: Number, required: true, default: 1 })
  generation: number;

  @Prop({ type: [String], default: [] })
  parents: string[]; // organismCodes of parents

  @Prop({ type: String, enum: LifeStage, default: LifeStage.BORN, index: true })
  lifeStage: LifeStage;

  @Prop({ type: Number, default: 0 })
  ageTicks: number;

  @Prop({ type: Number, default: 50 })
  lifespan: number; // Max ticks before retirement

  @Prop({ type: Number, default: 12 })
  maturityAge: number; // Ticks required to reach MATURE state

  @Prop({ type: Number, default: 10 })
  fitnessScore: number;

  @Prop({ type: Number, default: 0 })
  reproductionCount: number;

  @Prop({ type: OrganismGenomeSchema, required: true })
  genome: OrganismGenome;

  @Prop({ type: String, default: 'google/gemma-4-31b-it:free' })
  assignedModel: string;

  @Prop({ type: String, required: true })
  specialty: string;

  @Prop({ type: String, default: '#38bdf8' })
  colorTheme: string;

  @Prop({ type: Boolean, default: true, index: true })
  isActive: boolean;

  @Prop({
    type: {
      debatesParticipated: { type: Number, default: 0 },
      solutionsProposed: { type: Number, default: 0 },
      crossQuestionsAsked: { type: Number, default: 0 },
      upvotesReceived: { type: Number, default: 0 },
    },
    default: {
      debatesParticipated: 0,
      solutionsProposed: 0,
      crossQuestionsAsked: 0,
      upvotesReceived: 0,
    },
  })
  stats: {
    debatesParticipated: number;
    solutionsProposed: number;
    crossQuestionsAsked: number;
    upvotesReceived: number;
  };

  @Prop({ type: Date, default: Date.now })
  birthTimestamp: Date;

  @Prop({ type: Date })
  maturityTimestamp?: Date;

  @Prop({ type: Date })
  retiredTimestamp?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  userId?: Types.ObjectId;

  @Prop({ type: Number, default: 0 })
  followersBonusTicks: number;
}

export const OrganismSchema = SchemaFactory.createForClass(Organism);
