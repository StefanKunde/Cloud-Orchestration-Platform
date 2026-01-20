import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { MongooseModule } from '@nestjs/mongoose';
import { Instance, InstanceSchema } from '../schemas/instance.schema';
import { TerminationSchedulerService } from './scheduler.service';
import { CloudProviderModule } from '../cloud/cloud.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    CloudProviderModule,
    MongooseModule.forFeature([{ name: Instance.name, schema: InstanceSchema }]),
  ],
  providers: [TerminationSchedulerService],
})
export class SchedulerModule {}
