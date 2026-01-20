import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type StartLockDocument = HydratedDocument<StartLock>;

@Schema({ timestamps: true })
export class StartLock {
  @Prop({ required: true, unique: true }) userId!: string;
  @Prop({ required: true }) leaseId!: string;
  @Prop({ required: true }) leaseExpiresAt!: Date;
}

export const StartLockSchema = SchemaFactory.createForClass(StartLock);
StartLockSchema.index({ userId: 1 }, { unique: true });
StartLockSchema.index({ leaseExpiresAt: 1 });
