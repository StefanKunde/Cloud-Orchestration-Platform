import { IsString } from 'class-validator';

export class StopDto {
  @IsString()
  userId!: string;
}
