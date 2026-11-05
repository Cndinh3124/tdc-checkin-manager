import { Module } from '@nestjs/common';
import { PublicModule } from '../public/public.module';
import { DuesController } from './dues.controller';
import { DuesService } from './dues.service';

@Module({
  imports: [PublicModule],
  controllers: [DuesController],
  providers: [DuesService],
})
export class DuesModule {}
