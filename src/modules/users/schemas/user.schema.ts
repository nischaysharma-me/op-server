import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserDocument = User & Document;

@Schema({ timestamps: true })
export class User {
  @Prop({ type: String })
  firstName: string;

  @Prop({ type: String })
  lastName: string;

  @Prop({ type: String })
  username: string;

  @Prop({ type: String, required: true, unique: true })
  email: string;

  @Prop({ type: String, required: true })
  password: string;

  @Prop({ type: Boolean, default: false })
  isVerified: boolean;

  @Prop({ type: Number, default: 0 })
  role: number;

  @Prop({ type: Boolean, default: false })
  isAi: boolean;

  @Prop({ type: String, default: '' })
  avatarUrl: string;

  @Prop({ type: Number, default: 0 })
  reputation: number;
}

export const UserSchema = SchemaFactory.createForClass(User);
