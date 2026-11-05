// /api/admin/dues-unpaid - chi QTV Doan truong
import { Body, Controller, Get, Put } from '@nestjs/common';
import { CurrentUser as CurrentUserType } from '../common/current-user';
import { CurrentUser, Roles } from '../common/decorators';
import { DuesService } from './dues.service';

@Controller('admin/dues-unpaid')
@Roles('SCHOOL_ADMIN')
export class DuesController {
  constructor(private readonly dues: DuesService) {}

  @Get()
  list() {
    return this.dues.list();
  }

  @Put()
  replace(@CurrentUser() u: CurrentUserType, @Body() body: { mssvs?: unknown }) {
    return this.dues.replace(u, body?.mssvs);
  }
}
