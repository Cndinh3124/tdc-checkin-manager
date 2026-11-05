// Cac API doc cua trang diem danh: danh sach khoa, thong tin su kien theo token, lich su - dac ta 3.3, 5.4, 7
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { checkinState } from '../events/event-rules';
import { Event } from '../events/entities/event.entity';
import { Unit } from '../units/entities/unit.entity';
import { Attendance } from './entities/attendance.entity';
import { DeviceIdentity } from './device.service';
import { SettingsService } from '../settings/settings.service';
import { PublicLookupService } from './public-lookup.service';

export interface PublicEvent {
  title: string;
  description: string | null;
  locationName: string | null;
  startAt: Date;
  endAt: Date;
  checkinOpenAt: Date;
  checkinCloseAt: Date;
  // [BM] khong tra toa do / ban kinh: nguoi nhan anh QR tu xa se gia GPS khop duoc. Khoang cach tinh o server.
  requiresGps: boolean;
  requireCheckout: boolean;
}

const HISTORY_LIMIT = 50;

const toPublicEvent = (e: Event): PublicEvent => ({
  title: e.title,
  description: e.description,
  locationName: e.locationName,
  startAt: e.startAt,
  endAt: e.endAt,
  checkinOpenAt: e.checkinOpenAt,
  checkinCloseAt: e.checkinCloseAt,
  requiresGps: e.latitude !== null,
  requireCheckout: e.requireCheckout,
});

@Injectable()
export class QueryService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly lookup: PublicLookupService,
    private readonly settings: SettingsService,
  ) {}

  // [NV] 2.1: chi khoa dang hoat dong, khong co Doan truong
  async faculties(): Promise<Array<{ id: string; name: string; code: string }>> {
    const rows = await this.ds.getRepository(Unit).find({ where: { type: 'FACULTY', isActive: true }, order: { name: 'ASC' } });
    return rows.map((u) => ({ id: u.id, name: u.name, code: u.code }));
  }

  async eventByToken(device: DeviceIdentity, token: string) {
    const { event, purpose } = await this.lookup.resolveToken(token);
    const state = checkinState(event, new Date());
    const repo = this.ds.getRepository(Attendance);
    const mine = await repo.findOne({ where: { eventId: event.id, deviceId: device.id } });
    // [NV] 3.3: dien san thong tin neu thiet bi da tung diem danh
    const last = mine ? null : await repo.findOne({ where: { deviceId: device.id }, order: { checkinAt: 'DESC' } });
    return {
      event: toPublicEvent(event),
      purpose,
      state,
      verifyCodeRequired: purpose === 'CHECKOUT' && event.controlLevel === 'TIGHT',
      appeal: await this.appealInfo(event),
      mssvRegex: (await this.lookup.mssvRegex()).source,
      attendance: mine ? this.lookup.toView(mine, state) : null,
      prefill: last ? { mssv: last.mssv, fullName: last.fullName, facultyUnitId: last.facultyUnitId, email: last.email } : null,
      // ban sao cookie cho localStorage cua client - dac ta 4
      deviceToken: device.token,
      proxyWarning: await this.proxyWarning(device),
      duesWarning: await this.duesWarning(device),
    };
  }

  // [NV] 3.5: giao dien chi hien nut "Gui khieu nai" khi open = true
  private async appealInfo(event: Event): Promise<{ open: boolean; deadlineAt: Date }> {
    const deadlineAt = await this.lookup.appealDeadline(event);
    const blocked = event.archivedAt !== null || event.status === 'DRAFT' || event.status === 'CANCELLED';
    return { open: !blocked && new Date() <= deadlineAt, deadlineAt };
  }

  // [NV] 5.4: lich su cua cac MSSV hien dang gan voi thiet bi nay, ke ca luot do thiet bi khac diem danh,
  // de nguoi bi diem danh ho tu phat hien. Chi tra ten su kien + gio; ma xac nhan chi cua luot tu thiet bi nay.
  // [BM] (sua loi review 02/11/2026) luot do THIET BI KHAC chi hien khi su kien con trong han khieu nai:
  // nguoi bi diem danh ho van thay kip de khieu nai, con ai go MSSV cua nguoi khac thi khong xem duoc ca qua trinh tham gia.
  async history(device: DeviceIdentity | null) {
    if (!device) return { items: [] };
    const mine = await this.ds.query(
      'SELECT DISTINCT mssv FROM attendances WHERE device_id = ? AND voided_at IS NULL',
      [device.id],
    );
    if (mine.length === 0) return { items: [] };
    const days = await this.lookup.appealDays();
    const appealOpenSince = new Date(Date.now() - days * 24 * 3600_000); // end_at >= moc nay <=> con han khieu nai
    const rows = await this.ds
      .createQueryBuilder(Attendance, 'a')
      .innerJoin(Event, 'e', 'e.id = a.eventId')
      .select(['a.deviceId AS deviceId', 'a.checkinAt AS checkinAt', 'a.checkoutAt AS checkoutAt',
        'a.timeliness AS timeliness', 'a.confirmCode AS confirmCode', 'e.title AS title', 'e.startAt AS startAt'])
      .where('a.mssv IN (:...mssvs) AND a.voidedAt IS NULL', { mssvs: mine.map((r: { mssv: string }) => r.mssv) })
      .andWhere('(a.deviceId = :dev OR e.endAt >= :since)', { dev: device.id, since: appealOpenSince })
      .orderBy('a.checkinAt', 'DESC')
      .limit(HISTORY_LIMIT)
      .getRawMany();
    const items = rows.map((r) => {
      const viaThisDevice = r.deviceId === device.id;
      return {
        eventTitle: r.title, eventStartAt: r.startAt, checkinAt: r.checkinAt, checkoutAt: r.checkoutAt,
        timeliness: r.timeliness, viaThisDevice, confirmCode: viaThisDevice ? r.confirmCode : null,
      };
    });
    return { items, proxyWarning: await this.proxyWarning(device), duesWarning: await this.duesWarning(device) };
  }

  // [NV] MSSV da diem danh tu thiet bi nay nam trong danh sach chua dong doan phi - hoi phi -> tra loi canh bao do QTV soan, khong thi null.
  private async duesWarning(device: DeviceIdentity): Promise<string | null> {
    const rows = await this.ds.query(
      `SELECT 1 FROM attendances a JOIN dues_unpaid d ON d.mssv = a.mssv WHERE a.device_id = ? AND a.voided_at IS NULL LIMIT 1`,
      [device.id],
    );
    return rows.length > 0 ? this.settings.get<string>('dues_warning_message') : null;
  }

  // [NV] 5.3: thiet bi bi gan co DEVICE_MULTI_MSSV (dung diem danh cho nhieu MSSV) -> giao dien hien canh bao do cho chinh nguoi cam may.
  // Chi tinh luot chua bi huy; khong tra chi tiet MSSV nao de tranh lo thong tin cua nguoi khac.
  private async proxyWarning(device: DeviceIdentity): Promise<boolean> {
    const rows = await this.ds.query(
      `SELECT 1 FROM attendance_flags f JOIN attendances a ON a.id = f.attendance_id
        WHERE a.device_id = ? AND a.voided_at IS NULL AND f.code = 'DEVICE_MULTI_MSSV' LIMIT 1`,
      [device.id],
    );
    return rows.length > 0;
  }
}
