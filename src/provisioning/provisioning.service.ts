import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'crypto';

import { Instance, InstanceDocument, InstanceState } from '../schemas/instance.schema';
import { StartLock, StartLockDocument } from '../schemas/start-lock.schema';
import { StartDto } from './dto/start.dto';
import { StopDto } from './dto/stop.dto';
import { CloudProviderService } from '../cloud/cloud.service';
import { buildUserDataBase64 } from '../util/cloudinit';

type ExecutionResult = 'started' | 'already-running';

function delay(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

function parseMs(input: string | undefined, def = 60_000): number {
  if (!input) return def;
  const s = String(input).trim();
  const m = s.match(/^(\d+)(ms|s|m)?$/i);
  if (!m) return def;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return def;
  const unit = (m[2] || 'ms').toLowerCase();
  switch (unit) {
    case 'ms': return n;
    case 's':  return n * 1_000;
    case 'm':  return n * 60_000;
    default:   return def;
  }
}

// Exponential backoff with jitter
function computeBackoff(attempt: number, baseMs = 1500, maxMs = 8000) {
  const exp = Math.min(maxMs, baseMs * 2 ** attempt);
  const jitter = Math.floor(Math.random() * 250);
  return exp + jitter;
}

function parseIntSafe(input: string | undefined, def: number): number {
  const n = Number(input);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : def;
}

@Injectable()
export class ProvisioningService {
  constructor(
    @InjectModel(Instance.name) private InstanceModel: Model<InstanceDocument>,
    @InjectModel(StartLock.name) private StartLockModel: Model<StartLockDocument>,
    private cloud: CloudProviderService,
  ) {}

  //#region Lock Management
  private async acquireStartLock(userId: string, ms = Number(process.env.START_LOCK_MS ?? 15 * 60 * 1000)) {
    const now = new Date();
    const leaseId = randomUUID();
    const leaseExpiresAt = new Date(now.getTime() + ms);

    try {
      const lock = await this.StartLockModel.findOneAndUpdate(
        {
          userId,
          $or: [
            { leaseExpiresAt: { $lte: now } },
            { leaseExpiresAt: { $exists: false } },
          ],
        },
        {
          $set: { leaseId, leaseExpiresAt },
          $setOnInsert: { userId },
        },
        { new: true, upsert: true },
      ).exec();

      if (lock.leaseId !== leaseId && lock.leaseExpiresAt > now) return null;
      return { leaseId };
    } catch (e: any) {
      if (e?.code === 11000) return null;
      throw e;
    }
  }

  private async releaseStartLock(userId: string) {
    await this.StartLockModel.deleteOne({ userId }).exec();
  }
  //#endregion

  //#region Configuration
  private defaultRegion() { return process.env.CLOUD_REGION ?? 'us-east-1'; }
  private defaultPlan()   { return process.env.CLOUD_PLAN   ?? 'small-1cpu-1gb'; }

  private adminApiKey()  { return process.env.ADMIN_API_KEY!; }
  private controlApiUrl(){ return process.env.CONTROL_API_URL!; }
  private adminPort()    { return Number(process.env.ADMIN_API_PORT ?? 4310); }

  private async callAdminApi(ipv4: string, path: string, init?: RequestInit) {
    const url = `http://${ipv4}:${this.adminPort()}${path}`;
    const headers = {
        'Content-Type': 'application/json',
        'X-API-Key': this.adminApiKey(),
        ...(init?.headers ?? {}),
    } as Record<string,string>;
    const res = await fetch(url, { ...init, headers });
    return res;
  }
  //#endregion

  //#region Admin API Methods
  private async waitForAdmin(instance: InstanceDocument, timeoutMs?: number): Promise<void> {
    const fallback = parseMs(process.env.ADMIN_READY_TIMEOUT_MS, 120_000);
    const timeout = Number.isFinite(timeoutMs as any) && (timeoutMs as number) > 0
        ? (timeoutMs as number)
        : fallback;

    const start = Date.now();
    let lastStatus = 0;
    let lastText = '';

    while (Date.now() - start < timeout) {
        try {
        const res = await this.callAdminApi(instance.ipv4!, '/api/infra/health/status', { method: 'GET' });
        lastStatus = res.status;

        if (res.status === 200) return;
        if ([401, 403, 404, 405].includes(res.status)) return;

        lastText = await res.text().catch(() => '');
        } catch (e: any) {
        lastText = e?.message ?? 'fetch-error';
        }
        await delay(1200);
    }
    throw new Error(`Admin API not ready within ${timeout}ms (last=${lastStatus} ${lastText})`);
  }

  private async startExecutionOnce(instance: InstanceDocument, execution: any): Promise<ExecutionResult> {
    const res = await this.callAdminApi(instance.ipv4!, '/api/infra/execution/start', {
      method: 'POST',
      body: JSON.stringify(execution),
    });

    if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`Admin API execution start failed: ${res.status} ${txt}`);
    }

    let data: any = {};
    try { data = await res.json(); } catch { /* ignore */ }

    const s: string | undefined = data?.state;
    if (s === 'already-running' || s === 'started') return s;
    return 'started';
  }

  private async startExecutionWithRetry(instance: InstanceDocument, execution: any): Promise<'started'|'already-running'> {
    const maxAttempts = parseIntSafe(process.env.ADMIN_START_RETRIES, 6);

    await this.waitForAdmin(instance);

    let lastErr: any = null;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
        return await this.startExecutionOnce(instance, execution);
        } catch (e: any) {
        if (String(e?.message || '').toLowerCase().includes('unauthorized')) {
            throw e;
        }
        lastErr = e;
        await delay(computeBackoff(attempt));
        }
    }
    throw new Error(`startExecution failed after ${maxAttempts} attempts: ${lastErr?.message ?? lastErr}`);
  }

  private async startExecution(instance: InstanceDocument, execution: any) {
    const res = await this.callAdminApi(instance.ipv4!, '/api/infra/execution/start', {
      method: 'POST',
      body: JSON.stringify(execution),
    });
    if (!res.ok) throw new Error(`Admin API execution start failed: ${res.status}`);
  }

  private async stopExecution(instance: InstanceDocument) {
    await this.callAdminApi(instance.ipv4!, '/api/infra/execution/stop', { method: 'POST' }).catch(() => null);
  }
  //#endregion

  //#region Billing Management
  private destroyBufferMs(): number {
    return parseMs(process.env.DESTROY_BUFFER_MS, 60_000);
  }

  // Next billing boundary from anchor
  private nextBillingBoundary(from: Date, anchor: Date): Date {
    const H = 60 * 60 * 1000;
    const delta = from.getTime() - anchor.getTime();
    const periods = delta <= 0 ? 1 : Math.ceil(delta / H);
    return new Date(anchor.getTime() + periods * H);
  }

  // Termination time at billing boundary minus buffer
  private computeTerminationTimeAtBillingBoundary(anchor: Date, now: Date) {
    const boundary = this.nextBillingBoundary(now, anchor);
    const terminationAt = new Date(boundary.getTime() - this.destroyBufferMs());
    const immediate = terminationAt.getTime() <= now.getTime();
    return { terminationAt, boundary, immediate };
  }
  //#endregion

  //#region Public API
  async start(dto: StartDto) {
    // Locate existing active instance
    const existing = await this.InstanceModel.findOne({
      userId: dto.userId,
      state: { $in: [InstanceState.PROVISIONING, InstanceState.READY, InstanceState.EXECUTING, InstanceState.IDLE] },
    }).exec();

    if (existing) {
      // Cancel termination, update config
      existing.scheduledTerminationAt = undefined;
      existing.executionConfigJson = dto.execution;
      existing.lastStartAt = new Date();
      await existing.save();

      if (existing.state === InstanceState.PROVISIONING) {
        await this.InstanceModel.findOneAndUpdate(
          { _id: existing._id },
          {
            $inc: { commandEpoch: 1 },
            $set: {
              lastCommand: 'start',
              lastCommandAt: new Date(),
              postProvisionAction: 'restarted',
              postProvisionActionEpoch: undefined,
            },
          }
        ).exec();

        return { ok: true, reused: true, state: existing.state, instanceId: existing.id };
      }

      // Restart execution if ready/idle
      if (existing.state === InstanceState.READY || existing.state === InstanceState.IDLE) {
        try {
          await this.startExecution(existing, dto.execution);
          existing.state = InstanceState.EXECUTING;
          existing.executionRunning = true;
          existing.lastCommand = 'start';
          await existing.save();
        } catch {
          // Remain in READY state on failure
        }
      }
      return { ok: true, reused: true, state: existing.state, instanceId: existing.id };
    }

    // Acquire lock for concurrent safety
    const lock = await this.acquireStartLock(dto.userId);
    if (!lock) {
      return { ok: true, progress: 'already-starting' };
    }

    const region = this.defaultRegion() ?? dto.region;
    const plan   = this.defaultPlan() ?? dto.plan;

    try {
      // Build cloud-init user-data
      const { b64, hash } = buildUserDataBase64({
        adminApiKey: this.adminApiKey(),
        controlApiUrl: this.controlApiUrl(),
      });

      // Create cloud instance
      const payload: any = { region, plan, enable_ipv6: true, user_data: b64, label: `user-${dto.userId}` };
      if (dto.snapshotId ?? process.env.SNAPSHOT_ID) payload.snapshot_id = dto.snapshotId ?? process.env.SNAPSHOT_ID;

      const inst = await this.cloud.createInstance(payload);

      // Persist instance metadata
      const instance = await this.InstanceModel.create({
        userId: dto.userId,
        cloudInstanceId: inst.id,
        region, plan,
        snapshotId: payload.snapshot_id ?? undefined,
        state: InstanceState.PROVISIONING,
        cloudInitHash: hash,
        executionConfigJson: dto.execution,
        lastStartAt: new Date(),
        adminApiKey: this.adminApiKey(),
      });

      await this.InstanceModel.findOneAndUpdate(
        { _id: instance._id },
        {
            $inc: { commandEpoch: 1 },
            $set: {
            lastCommand: 'start',
            lastCommandAt: new Date(),
            postProvisionAction: undefined,
            postProvisionActionEpoch: undefined,
            },
        }
      ).exec();

      return { ok: true, reused: false, state: 'PROVISIONING', instanceId: instance.id };
    } catch (e) {
      await this.releaseStartLock(dto.userId);
      throw e;
    }
  }

  async phoneHomeDone(instanceId: string) {
    const instance = await this.InstanceModel.findOne({
      cloudInstanceId: instanceId,
      state: InstanceState.PROVISIONING,
    }).exec();

    if (!instance) {
      return { ok: true, note: 'no-op (unknown or already handled)' };
    }

    // Fetch cloud instance metadata
    const inst = await this.cloud.getInstance(instanceId);
    instance.ipv4 = inst?.main_ip;
    instance.adminApiUrl = instance.ipv4 ? `http://${instance.ipv4}:${this.adminPort()}` : undefined;
    instance.phoneHomeAt = new Date();

    // Store billing anchor
    if (inst?.created_at) {
      try { instance.instanceCreatedAt = new Date(inst.created_at); } catch {}
    }
    const billingAnchor = instance.instanceCreatedAt ?? instance.createdAt ?? new Date();

    if (!instance.ipv4) {
      instance.state = InstanceState.ERROR;
      instance.lastStartError = 'No IPv4 from cloud provider on phoneHome';
      await instance.save();
      await this.releaseStartLock(instance.userId);
      return { ok: false, error: 'no-ipv4' };
    }

    // Check for queued stop command
    const shouldTerminateAfterProvision =
      instance.postProvisionAction === 'terminate' &&
      instance.postProvisionActionEpoch === (instance.commandEpoch ?? 0) &&
      instance.lastCommand === 'stop';

    if (shouldTerminateAfterProvision) {
      const now = new Date();
      const { terminationAt, boundary, immediate } = this.computeTerminationTimeAtBillingBoundary(billingAnchor, now);

      instance.postProvisionAction = undefined;
      instance.postProvisionActionEpoch = undefined;

      if (!immediate) {
        instance.state = InstanceState.IDLE;
        instance.executionRunning = false;
        instance.scheduledTerminationAt = terminationAt;
        await instance.save();
        await this.releaseStartLock(instance.userId);
        return {
          ok: true,
          state: instance.state,
          scheduledTerminationAt: terminationAt.toISOString(),
          billingBoundary: boundary.toISOString(),
          bufferMs: this.destroyBufferMs(),
        };
      }

      // Terminate immediately
      try {
        instance.state = InstanceState.TERMINATING;
        await instance.save();
        await this.cloud.deleteInstance(instance.cloudInstanceId);
        instance.state = InstanceState.TERMINATED;
        instance.scheduledTerminationAt = undefined;
        await instance.save();
        await this.releaseStartLock(instance.userId);
        return { ok: true, state: instance.state, terminated: true };
      } catch (e: any) {
        if (e?.response?.status === 404) {
          instance.state = InstanceState.TERMINATED;
          await instance.save();
          await this.releaseStartLock(instance.userId);
          return { ok: true, state: instance.state, terminated: true };
        }
        instance.state = InstanceState.ERROR;
        await instance.save();
        await this.releaseStartLock(instance.userId);
        throw e;
      }
    }

    // Normal flow: start execution if configured
    instance.state = InstanceState.READY;
    await instance.save();

    let executionState: ExecutionResult | null = null;
    try {
      if (instance.executionConfigJson) {
        executionState = await this.startExecutionWithRetry(instance, instance.executionConfigJson);
        instance.state = InstanceState.EXECUTING;
        instance.executionRunning = true;
        instance.lastStartError = undefined;
        instance.lastStartAt = new Date();
        await instance.save();
      }
    } catch (e: any) {
      instance.state = InstanceState.READY;
      instance.executionRunning = false;
      instance.lastStartError = e?.message ?? 'startExecution failed';
      await instance.save();
    } finally {
      await this.releaseStartLock(instance.userId);
    }

    return executionState
      ? { ok: true, state: executionState, ipv4: instance.ipv4 }
      : { ok: true, state: 'ready', ipv4: instance.ipv4 };
  }

  async stop(dto: StopDto) {
    // Queue stop if still provisioning
    const provisioning = await this.InstanceModel.findOne({
      userId: dto.userId,
      state: InstanceState.PROVISIONING,
    }).exec();

    if (provisioning) {
      const updated = await this.InstanceModel.findOneAndUpdate(
        { _id: provisioning._id },
        {
          $inc: { commandEpoch: 1 },
          $set: {
            lastCommand: 'stop',
            lastCommandAt: new Date(),
            postProvisionAction: 'terminate',
            postProvisionActionEpoch: (provisioning.commandEpoch ?? 0) + 1,
          },
        },
        { new: true }
      ).exec();

      return { ok: true, state: 'queued-terminate-after-provision' as const, epoch: updated?.commandEpoch };
    }

    // Stop active execution
    const instance = await this.InstanceModel.findOne({
      userId: dto.userId,
      state: { $in: [InstanceState.EXECUTING, InstanceState.READY, InstanceState.IDLE] },
    }).exec();

    if (!instance) return { ok: true, exists: false };

    instance.commandEpoch = (instance.commandEpoch ?? 0) + 1;
    instance.lastCommand = 'stop';
    instance.lastCommandAt = new Date();

    // Best-effort: stop execution
    if (instance.ipv4 && instance.executionRunning) {
      await this.stopExecution(instance).catch(() => null);
    }
    instance.executionRunning = false;
    instance.lastStopAt = new Date();

    // Schedule termination at billing boundary
    const anchor: Date = instance.instanceCreatedAt ?? instance.createdAt ?? new Date();
    const now = new Date();
    const { terminationAt, immediate } = this.computeTerminationTimeAtBillingBoundary(anchor, now);

    if (!immediate) {
      instance.state = InstanceState.IDLE;
      instance.scheduledTerminationAt = terminationAt;
      await instance.save();
      return {
        ok: true,
        state: instance.state,
        scheduledTerminationAt: terminationAt.toISOString(),
        epoch: instance.commandEpoch,
      };
    }

    // Immediate termination
    try {
      instance.state = InstanceState.TERMINATING;
      await instance.save();
      await this.cloud.deleteInstance(instance.cloudInstanceId);
      instance.state = InstanceState.TERMINATED;
      instance.scheduledTerminationAt = undefined;
      await instance.save();
      return { ok: true, state: instance.state, terminated: true, epoch: instance.commandEpoch };
    } catch (e: any) {
      if (e?.response?.status === 404) {
        instance.state = InstanceState.TERMINATED;
        await instance.save();
        return { ok: true, state: instance.state, terminated: true, epoch: instance.commandEpoch };
      }
      instance.state = InstanceState.ERROR;
      await instance.save();
      throw e;
    }
  }

  async status(userId: string) {
    const s = await this.InstanceModel.findOne({ userId }).exec();
    if (!s) return { exists: false, status: 'not-found' };
    return {
      exists: true,
      status: s.state,
      executionRunning: s.executionRunning,
      ipv4: s.ipv4,
      scheduledTerminationAt: s.scheduledTerminationAt
    };
  }

  async getExecutionConfigByInstance(instanceId: string) {
    const s = await this.InstanceModel.findOne({ cloudInstanceId: instanceId }).lean().exec();
    return s?.executionConfigJson ?? null;
  }
  //#endregion
}
