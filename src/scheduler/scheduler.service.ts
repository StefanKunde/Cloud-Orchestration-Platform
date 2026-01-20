import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Instance, InstanceDocument, InstanceState } from '../schemas/instance.schema';
import { CloudProviderService } from '../cloud/cloud.service';
import { randomUUID } from 'crypto';

@Injectable()
export class TerminationSchedulerService {
  private readonly log = new Logger(TerminationSchedulerService.name);
  private readonly concurrency = Number(process.env.DESTROY_CONCURRENCY ?? 30);
  private readonly leaseMs      = Number(process.env.DESTROY_LEASE_MS ?? 120000);

  constructor(
    @InjectModel(Instance.name) private InstanceModel: Model<InstanceDocument>,
    private cloud: CloudProviderService,
  ) {}

  @Cron('*/15 * * * * *') // every 15 seconds
  async scan() {
    for (let i = 0; i < this.concurrency; i++) {
      const job = await this.tryLockOneScheduled();
      if (!job) break;
      this.runTermination(job).catch((e) => this.log.error(e?.message || e));
    }
  }

  private async tryLockOneScheduled(): Promise<InstanceDocument | null> {
    const now = new Date();
    const leaseId = randomUUID();
    const leaseUntil = new Date(now.getTime() + this.leaseMs);

    const doc = await this.InstanceModel.findOneAndUpdate(
      {
        state: InstanceState.IDLE,
        executionRunning: false,
        scheduledTerminationAt: { $lte: now },
        $or: [
          { terminationLeaseExpiresAt: { $lt: now } },
          { terminationLeaseExpiresAt: { $exists: false } },
        ],
      },
      {
        $set: {
          state: InstanceState.TERMINATING,
          terminationLeaseId: leaseId,
          terminationLockedAt: now,
          terminationLeaseExpiresAt: leaseUntil,
        },
      },
      { new: true },
    ).exec();

    return doc;
  }

  private async runTermination(instance: InstanceDocument) {
    try {
      await this.cloud.deleteInstance(instance.cloudInstanceId);
      instance.state = InstanceState.TERMINATED;
      instance.scheduledTerminationAt = undefined;
      instance.terminationLeaseId = undefined;
      instance.terminationLeaseExpiresAt = undefined;
      instance.terminationLockedAt = undefined;
      await instance.save();
    } catch (e: any) {
      if (e?.response?.status === 404) {
        instance.state = InstanceState.TERMINATED;
        instance.scheduledTerminationAt = undefined;
        instance.terminationLeaseId = undefined;
        instance.terminationLeaseExpiresAt = undefined;
        instance.terminationLockedAt = undefined;
        await instance.save();
        return;
      }
      instance.state = InstanceState.ERROR;
      await instance.save();
      throw e;
    }
  }
}
