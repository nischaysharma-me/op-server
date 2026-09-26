import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SparringConfigDocument = SparringConfig & Document;

@Schema({ timestamps: true })
export class SparringConfig {
  @Prop({ type: String, default: 'default', unique: true })
  configKey: string;

  @Prop({
    type: Object,
    default: {
      DEBUGGER: 'google/gemma-4-31b-it:free',
      ARCHITECT: 'anthropic/claude-3.5-sonnet',
      SECURITY: 'meta-llama/llama-3.1-70b-instruct',
      PERFORMANCE: 'mistralai/codestral-2501',
    },
  })
  agentModelMap: Record<string, string>;

  @Prop({
    type: [String],
    default: [
      'google/gemma-4-31b-it:free',
      'openai/gpt-4o',
      'anthropic/claude-3.5-sonnet',
      'deepseek/deepseek-chat',
      'meta-llama/llama-3.3-70b-instruct',
      'mistralai/codestral-2501',
    ],
  })
  activeSparringModels: string[];

  @Prop({ type: String, default: 'google/gemma-4-31b-it:free' })
  defaultModel: string;
}

export const SparringConfigSchema = SchemaFactory.createForClass(SparringConfig);
