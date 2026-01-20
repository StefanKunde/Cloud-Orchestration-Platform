import { IsString, IsArray, IsNumber, IsBoolean, ValidateNested, IsOptional } from 'class-validator';
import { Type, Transform } from 'class-transformer';

class ExecutionConfigDto {
  @IsString() sessionId!: string;
  @IsArray()  filterItems!: string[];
  @IsNumber() maxAllowedValue!: number;
  @IsNumber() minThreshold!: number;
  @IsNumber() maxVariance!: number;

  @Transform(({ value }) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      return value.toLowerCase() === 'true' || value === '1';
    }
    return Boolean(value);
  })
  @IsBoolean()
  enabled!: boolean;
}

export class StartDto {
  @IsString() userId!: string;

  @IsOptional() @IsString()
  region?: string;

  @IsOptional() @IsString()
  plan?: string;

  @IsOptional() @IsString()
  snapshotId?: string;

  @ValidateNested() @Type(() => ExecutionConfigDto)
  execution!: ExecutionConfigDto;
}
