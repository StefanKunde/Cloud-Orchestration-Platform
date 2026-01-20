import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { Schema as MongooseSchema, SchemaTypes } from 'mongoose';

export type InstanceDocument = HydratedDocument<Instance>;

export enum InstanceState {
  PROVISIONING    = 'PROVISIONING',
  READY           = 'READY',
  EXECUTING       = 'EXECUTING',
  IDLE            = 'IDLE',
  TERMINATING     = 'TERMINATING',
  TERMINATED      = 'TERMINATED',
  ERROR           = 'ERROR',
}

@Schema({ timestamps: true })
export class Instance {
  @Prop({ required: true, index: true })
  userId!: string;

  @Prop({ required: true, index: true })
  cloudInstanceId!: string;

  @Prop({ required: true })
  region!: string;

  @Prop({ required: true })
  plan!: string;

  @Prop() snapshotId?: string;

  @Prop({ type: String, enum: Object.values(InstanceState), required: true, index: true })
  state!: InstanceState;

  @Prop({ default: false, index: true })
  executionRunning!: boolean;

  @Prop() lastStartAt?: Date;
  @Prop() lastStopAt?: Date;

  @Prop() instanceCreatedAt?: Date;
  @Prop() createdAt?: Date;

  // Billing/lifecycle management
  @Prop({ index: true })
  scheduledTerminationAt?: Date;

  // Termination lease (used by scheduler)
  @Prop() terminationLeaseId?: string;
  @Prop() terminationLeaseExpiresAt?: Date;
  @Prop() terminationLockedAt?: Date;

  // Bootstrap info
  @Prop() cloudInitHash?: string;
  @Prop() phoneHomeAt?: Date;

  @Prop() ipv4?: string;
  @Prop() adminApiUrl?: string;
  @Prop() adminApiKey?: string;

  // Execution params from /start request
  @Prop({ type: SchemaTypes.Mixed })
  executionConfigJson?: any;

  @Prop()
  lastStartError?: string;

  @Prop({ default: 0 })
  commandEpoch!: number;

  @Prop({ enum: ['start', 'stop'], required: false })
  lastCommand?: 'start' | 'stop';

  @Prop()
  lastCommandAt?: Date;

  // Post-provision action
  @Prop({ enum: ['terminate', 'restarted'], required: false })
  postProvisionAction?: 'terminate';

  @Prop()
  postProvisionActionEpoch?: number;
}

export const InstanceSchema = SchemaFactory.createForClass(Instance);

// Helpful indexes
InstanceSchema.index({ userId: 1, state: 1 });
InstanceSchema.index({ scheduledTerminationAt: 1 });

// (Optional) Enforce "only one active instance per user":
// Active states are everything except TERMINATED/ERROR.
// Uncomment if you want this constraint at DB level.
// InstanceSchema.index(
//   { userId: 1 },
//   {
//     unique: true,
//     partialFilterExpression: { state: { $in: [InstanceState.PROVISIONING, InstanceState.READY, InstanceState.EXECUTING, InstanceState.IDLE, InstanceState.TERMINATING] } },
//     name: 'uniq_active_server_per_user',
//   },
// );
