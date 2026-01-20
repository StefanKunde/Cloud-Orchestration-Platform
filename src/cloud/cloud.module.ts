import { Module } from '@nestjs/common';
import { CloudProviderService } from './cloud.service';
@Module({ providers: [CloudProviderService], exports: [CloudProviderService] })
export class CloudProviderModule {}
