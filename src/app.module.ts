import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ProvisioningModule } from './provisioning/provisioning.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { CloudProviderModule } from './cloud/cloud.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        const uri = config.get<string>('MONGO_URI')!;
        const mongoose = await import('mongoose');
        console.log('[MongoDB] Connecting...');

        try {
          await mongoose.connect(uri, {
            serverSelectionTimeoutMS: 5000,
          });
          console.log('[MongoDB] Connected');
        } catch (err: any) {
          console.error('[MongoDB] Connection failed:', err.message);
          throw err;
        }

        return {
          uri,
        };
      },
    }),
    CloudProviderModule,
    ProvisioningModule,
    SchedulerModule,
  ],
})
export class AppModule {}
