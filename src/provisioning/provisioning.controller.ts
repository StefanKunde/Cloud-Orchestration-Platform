import { Body, Controller, Get, HttpCode, HttpStatus, NotFoundException, Param, Post, Res } from '@nestjs/common';
import { ProvisioningService } from './provisioning.service';
import { StartDto } from './dto/start.dto';
import { StopDto } from './dto/stop.dto';

@Controller('')
export class ProvisioningController {
  constructor(private readonly svc: ProvisioningService) {}

  @Post('executions/start')
  @HttpCode(202)
  async start(@Body() dto: StartDto) {
    return this.svc.start(dto);
  }

  @Post('executions/stop')
  async stop(@Body() dto: StopDto) {
    return this.svc.stop(dto);
  }

  @Get('executions/:userId/status')
  async status(@Param('userId') userId: string) {
    return this.svc.status(userId);
  }

  // Cloud-init callback
  @Post('provisioning/phone-home/:instanceId/done')
  @HttpCode(200)
  async phoneHomeDone(@Param('instanceId') instanceId: string) {
    return this.svc.phoneHomeDone(instanceId);
  }

  @Get('provisioning/config/:instanceId')
  async getConfig(
    @Param('instanceId') instanceId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cfg = await this.svc.getExecutionConfigByInstance(instanceId);
    if (!cfg) {
      return new NotFoundException;
    }
    return cfg;
  }
}
