import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProvisioningController } from './provisioning.controller';
import { ProvisioningService } from './provisioning.service';
import { Instance, InstanceSchema } from '../schemas/instance.schema';
import { StartLock, StartLockSchema } from '../schemas/start-lock.schema';
import { CloudProviderModule } from '../cloud/cloud.module';

@Module({
  imports: [
    CloudProviderModule,
    MongooseModule.forFeature([
      { name: Instance.name, schema: InstanceSchema },
      { name: StartLock.name, schema: StartLockSchema },
    ]),
  ],
  controllers: [ProvisioningController],
  providers: [ProvisioningService],
})
export class ProvisioningModule {}
