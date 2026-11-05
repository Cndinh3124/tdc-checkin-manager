// Duyet va quan ly luot diem danh trong trang quan tri - dac ta 3.6, 3.7, 5.3
// Luong moi thao tac: kiem tra quyen + pham vi -> kiem tra trang thai -> xu ly -> ghi lich su + nhat ky.
import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import ExcelJS from 'exceljs';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { CurrentUser } from '../common/current-user';
import { describeClient } from '../common/client-info';
import { Page } from '../common/dto/pagination.dto';
import { Err } from '../common/errors';
import { escapeLike } from '../common/sql';
import { UnitScopeService } from '../common/unit-scope.service';
import { Event } from '../events/entities/event.entity';
import { EventsService } from '../events/events.service';
import { newConfirmCode } from '../public/checkin.service';
import { Attendance } from '../public/entities/attendance.entity';
import { AttendanceEdit } from '../public/entities/attendance-edit.entity';
import { AttendanceFlag } from '../public/entities/attendance-flag.entity';
import { PublicLookupService } from '../public/public-lookup.service';
import { safeCell } from '../reports/reports.service';
import {
  AttendanceChange, AttendanceDetail, AttendanceDto, AttendanceEditItem, AttendanceListQuery, attendanceAuditView, BulkDto,
  EditAttendanceAdminDto, ManualAttendanceDto, ManualFieldsDto, OtherAttendanceItem, ReviewDto, toAttendanceDto,
} from './dto/attendance.dto';
import { ReviewService } from './review.service';

const DETAIL_OTHER_LIMIT = 30;
const EXPORT_MAX_ROWS = 20_000;
const VN_OFFSET_MS = 7 * 3600_000;
const FLAG_LABEL: Record<string, string> = {
  DUPLICATE_MSSV: 'Trùng MSSV', DEVICE_MULTI_MSSV: 'Thiết bị dùng cho nhiều MSSV', MSSV_MULTI_DEVICE: 'MSSV dùng nhiều thiết bị',
  NAME_MISMATCH: 'Tên khác lần trước', FACULTY_MISMATCH: 'Khoa khác lần trước', NEW_DEVICE: 'Thiết bị mới', DUES_UNPAID: 'Chưa đóng đoàn phí - hội phí',
  BURST_SAME_FINGERPRINT: 'Nhiều MSSV cùng máy', GPS_OUTSIDE: 'Ngoài vùng GPS', GPS_LOW_ACCURACY: 'GPS kém chính xác',
  GPS_MISSING: 'Không có GPS', NO_CHECKOUT: 'Chưa điểm danh ra', MANUAL_ENTRY: 'Thêm thủ công',
};
const REVIEW_LABEL: Record<string, string> = { PENDING: 'Chờ duyệt', APPROVED: 'Đã duyệt', REJECTED: 'Từ chối' };
// truong trong lich su sua duoc hien (dung thu tu nay); khoa doi id -> ten
const EDIT_FIELDS = ['mssv', 'fullName', 'email', 'facultyUnitId', 'checkinAt', 'checkoutAt', 'reviewStatus', 'voidedAt'];

export interface AttendanceSummary {
  total: number; // khong tinh luot da huy
  pending: number;
  approved: number;
  rejected: number;
  voided: number;
  flagged: number;
  cleanPending: number; // cho duyet va khong co co: nhom "duyet hang loat"
  noCheckout: number;
}

@Injectable()
export class AttendancesService {
  constructor(
    @InjectRepository(Attendance) private readonly repo: Repository<Attendance>,
    @InjectRepository(Event) private readonly eventRepo: Repository<Event>,
    @InjectDataSource() private readonly ds: DataSource,
    private readonly events: EventsService,
    private readonly review: ReviewService,
    private readonly lookup: PublicLookupService,
    private readonly scope: UnitScopeService,
    private readonly audit: AuditService,
  ) {}

  // ---------- doc ----------

  // bo loc dung chung cho danh sach va xuat Excel: quyen + pham vi khoa + cac dieu kien loc
  private async filtered(actor: CurrentUser, eventId: string, q: AttendanceListQuery) {
    const { event, access } = await this.readable(actor, eventId);
    const qb = this.repo.createQueryBuilder('a').leftJoinAndSelect('a.faculty', 'f').where('a.eventId = :eventId', { eventId });
    await this.limitToFaculties(actor, access, qb);
    if (q.review) qb.andWhere('a.reviewStatus = :review', { review: q.review });
    if (q.source) qb.andWhere('a.source = :source', { source: q.source });
    if (q.voided === 'exclude') qb.andWhere('a.voidedAt IS NULL');
    if (q.voided === 'only') qb.andWhere('a.voidedAt IS NOT NULL');
    const anyFlag = 'EXISTS (SELECT 1 FROM attendance_flags fl WHERE fl.attendance_id = a.id)';
    if (q.flagged === 'yes') qb.andWhere(anyFlag);
    if (q.flagged === 'no') qb.andWhere(`NOT ${anyFlag}`);
    if (q.flag) {
      qb.andWhere('EXISTS (SELECT 1 FROM attendance_flags fc WHERE fc.attendance_id = a.id AND fc.code = :flag)', { flag: q.flag });
    }
    if (q.q) {
      const like = `%${escapeLike(q.q)}%`;
      qb.andWhere('(a.mssv LIKE :like OR a.fullName LIKE :like)', { like });
    }
    return { event, access, qb };
  }

  async list(actor: CurrentUser, eventId: string, q: AttendanceListQuery): Promise<Page<AttendanceDto>> {
    const { access, qb } = await this.filtered(actor, eventId, q);
    const [rows, total] = await qb
      .orderBy('a.checkinAt', 'ASC').addOrderBy('a.id', 'ASC')
      .skip((q.page - 1) * q.limit).take(q.limit)
      .getManyAndCount();
    const flags = await this.flagsOf(rows.map((r) => r.id));
    const items = rows.map((r) => toAttendanceDto(r, flags.get(r.id) ?? [], access === 'manage'));
    return { items, total, page: q.page, limit: q.limit };
  }

  // [BM] xuat danh sach diem danh cua mot su kien ra Excel. Cung quyen + pham vi + bo loc voi list();
  // khong xuat ma xac nhan / ma thiet bi / IP / toa do (cot Thiet bi la nhan trinh duyet + HDH); o chuoi qua safeCell; ghi nhat ky.
  async exportXlsx(actor: CurrentUser, eventId: string, q: AttendanceListQuery): Promise<Buffer> {
    const { event, qb } = await this.filtered(actor, eventId, q);
    const rows = await qb.orderBy('a.checkinAt', 'ASC').addOrderBy('a.id', 'ASC').take(EXPORT_MAX_ROWS + 1).getMany();
    if (rows.length > EXPORT_MAX_ROWS) {
      throw Err.bad('EXPORT_TOO_LARGE', `Quá ${EXPORT_MAX_ROWS.toLocaleString('vi-VN')} lượt, hãy lọc bớt rồi xuất lại.`);
    }
    const flags = await this.flagsOf(rows.map((r) => r.id));
    const when = (d: Date | null) => (d ? new Date(d.getTime() + VN_OFFSET_MS).toISOString().replace('T', ' ').slice(0, 16) : '');

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Điểm danh');
    ws.columns = [
      { header: 'STT', key: 'no', width: 6 }, { header: 'MSSV', key: 'mssv', width: 14 }, { header: 'Họ tên', key: 'name', width: 30 },
      { header: 'Email', key: 'email', width: 30 }, { header: 'Khoa', key: 'faculty', width: 30 },
      { header: 'Giờ vào', key: 'in', width: 17 }, { header: 'Giờ ra', key: 'out', width: 17 }, { header: 'Đúng giờ', key: 'timely', width: 11 },
      { header: 'Thiết bị', key: 'client', width: 26 },
      { header: 'Nguồn', key: 'source', width: 12 }, { header: 'Duyệt', key: 'review', width: 12 }, { header: 'Ghi chú duyệt', key: 'note', width: 28 },
      { header: 'ĐRL', key: 'drl', width: 8 }, { header: 'Cờ nghi vấn', key: 'flags', width: 36 }, { header: 'Đã hủy', key: 'voided', width: 28 },
    ];
    rows.forEach((a, i) => {
      ws.addRow({
        no: i + 1, mssv: safeCell(a.mssv), name: safeCell(a.fullName), email: safeCell(a.email ?? ''), faculty: safeCell(a.faculty?.name ?? ''),
        in: when(a.checkinAt), out: when(a.checkoutAt), timely: a.timeliness === 'ON_TIME' ? 'Đúng giờ' : 'Trễ',
        client: describeClient(a.userAgent) ?? '',
        source: a.source === 'MANUAL' ? 'Thủ công' : 'Tự điểm danh', review: REVIEW_LABEL[a.reviewStatus] ?? a.reviewStatus,
        note: safeCell(a.reviewNote ?? ''), drl: a.drlAwarded, flags: (flags.get(a.id) ?? []).map((f) => FLAG_LABEL[f.code] ?? f.code).join(', '),
        voided: a.voidedAt ? safeCell(a.voidReason ? `Đã hủy: ${a.voidReason}` : 'Đã hủy') : '',
      });
    });
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.autoFilter = { from: 'A1', to: 'O1' };

    const info = wb.addWorksheet('Thông tin');
    info.columns = [{ key: 'k', width: 22 }, { key: 'v', width: 50 }];
    info.addRows([
      { k: 'Sự kiện', v: safeCell(event.title) }, { k: 'Bắt đầu', v: when(event.startAt) }, { k: 'Kết thúc', v: when(event.endAt) },
      { k: 'Số dòng xuất', v: rows.length }, { k: 'Xuất lúc', v: when(new Date()) },
    ]);
    info.getColumn('k').font = { bold: true };

    await this.audit.log(actor, 'ATTENDANCE_EXPORT', 'event', eventId, {
      after: { rows: rows.length, review: q.review ?? null, voided: q.voided, flagged: q.flagged ?? null, source: q.source ?? null },
    });
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  async summary(actor: CurrentUser, eventId: string): Promise<AttendanceSummary> {
    const { access } = await this.readable(actor, eventId);
    const qb = this.repo.createQueryBuilder('a').where('a.eventId = :eventId', { eventId });
    await this.limitToFaculties(actor, access, qb);
    const anyFlag = 'EXISTS (SELECT 1 FROM attendance_flags fl WHERE fl.attendance_id = a.id)';
    const r = await qb
      .select('SUM(a.voidedAt IS NULL)', 'total')
      .addSelect("SUM(a.voidedAt IS NULL AND a.reviewStatus = 'PENDING')", 'pending')
      .addSelect("SUM(a.voidedAt IS NULL AND a.reviewStatus = 'APPROVED')", 'approved')
      .addSelect("SUM(a.voidedAt IS NULL AND a.reviewStatus = 'REJECTED')", 'rejected')
      .addSelect('SUM(a.voidedAt IS NOT NULL)', 'voided')
      .addSelect(`SUM(a.voidedAt IS NULL AND ${anyFlag})`, 'flagged')
      .addSelect(`SUM(a.voidedAt IS NULL AND a.reviewStatus = 'PENDING' AND NOT ${anyFlag})`, 'cleanPending')
      .addSelect("SUM(a.voidedAt IS NULL AND EXISTS (SELECT 1 FROM attendance_flags fn WHERE fn.attendance_id = a.id AND fn.code = 'NO_CHECKOUT'))", 'noCheckout')
      .getRawOne();
    const n = (v: unknown) => Number(v ?? 0);
    return {
      total: n(r.total), pending: n(r.pending), approved: n(r.approved), rejected: n(r.rejected),
      voided: n(r.voided), flagged: n(r.flagged), cleanPending: n(r.cleanPending), noCheckout: n(r.noCheckout),
    };
  }

  // [NV] A07: chi tiet mot luot cho ngan keo ben phai. Nguoi chi-xem chi thay luot cua sinh vien khoa minh;
  // ngoai pham vi deu 404. Su kien khac cua MSSV chi gom su kien nguoi xem nhin thay duoc.
  async detail(actor: CurrentUser, id: string): Promise<AttendanceDetail> {
    const a = await this.repo.findOne({ where: { id }, relations: { faculty: true } });
    if (!a) throw Err.notFound('lượt điểm danh');
    const { access } = await this.readable(actor, a.eventId).catch(() => {
      throw Err.notFound('lượt điểm danh');
    });
    if (access === 'view' && !(await this.scope.canAccessUnit(actor, a.facultyUnitId))) throw Err.notFound('lượt điểm danh');
    const attendance = toAttendanceDto(a, (await this.flagsOf([id])).get(id) ?? [], access === 'manage');
    return { attendance, edits: await this.editsOf(id), otherAttendances: await this.othersOf(actor, a) };
  }

  private async editsOf(id: string): Promise<AttendanceEditItem[]> {
    const rows: Array<{ at: Date; actorType: 'STUDENT' | 'ADMIN'; actorName: string | null; reason: string | null; oldJson: unknown; newJson: unknown }> =
      await this.ds.query(
        `SELECT ae.created_at AS at, ae.actor_type AS actorType, ae.reason AS reason, ae.old_json AS oldJson, ae.new_json AS newJson,
                CASE WHEN ae.actor_type = 'ADMIN' THEN u.full_name ELSE NULL END AS actorName
           FROM attendance_edits ae LEFT JOIN admin_users u ON ae.actor_type = 'ADMIN' AND u.id = ae.actor_id
          WHERE ae.attendance_id = ? ORDER BY ae.id DESC`,
        [id],
      );
    const parse = (v: unknown): Record<string, unknown> => (typeof v === 'string' ? JSON.parse(v) : (v as Record<string, unknown>) ?? {});
    const parsed = rows.map((r) => ({ ...r, before: parse(r.oldJson), after: parse(r.newJson) }));
    // doi id khoa sang ten mot lan cho ca danh sach
    const unitIds = new Set<string>();
    for (const r of parsed) for (const o of [r.before, r.after]) if (typeof o.facultyUnitId === 'string') unitIds.add(o.facultyUnitId);
    const names = new Map<string, string>();
    if (unitIds.size) {
      const units: Array<{ id: string; name: string }> = await this.ds.query('SELECT id, name FROM units WHERE id IN (?)', [[...unitIds]]);
      for (const u of units) names.set(u.id, u.name);
    }
    const show = (k: string, v: unknown): string | null => {
      if (v === null || v === undefined) return null;
      if (k === 'facultyUnitId') return names.get(String(v)) ?? String(v);
      return String(v);
    };
    return parsed.map((r) => {
      const changes: AttendanceChange[] = [];
      for (const k of EDIT_FIELDS) {
        if (!(k in r.before) && !(k in r.after)) continue;
        const from = show(k, r.before[k]);
        const to = show(k, r.after[k]);
        if (from !== to) changes.push({ field: k, from, to });
      }
      return { at: r.at, actorType: r.actorType, actorName: r.actorName ?? null, reason: r.reason, changes };
    });
  }

  private async othersOf(actor: CurrentUser, a: Attendance): Promise<OtherAttendanceItem[]> {
    // MSSV chinh + cac MSSV da gop vao no (cung mot nguoi)
    const [s] = await this.ds.query('SELECT merged_into AS mergedInto FROM students WHERE mssv = ?', [a.mssv]);
    const canon: string = s?.mergedInto ?? a.mssv;
    const visible = await this.events.visibleEventIds(actor);
    if (visible && visible.length === 0) return [];
    const rows = await this.ds.query(
      `SELECT a.id AS attendanceId, e.id AS eventId, e.title AS eventTitle, e.start_at AS eventStartAt, a.checkin_at AS checkinAt,
              a.mssv AS mssv, a.review_status AS reviewStatus, a.voided_at IS NOT NULL AS voided, a.drl_awarded AS drlAwarded
         FROM attendances a JOIN events e ON e.id = a.event_id
        WHERE (a.mssv = ? OR a.mssv IN (SELECT m.mssv FROM students m WHERE m.merged_into = ?))
          AND a.id <> ? AND a.event_id <> ?
          ${visible ? 'AND a.event_id IN (?)' : ''}
        ORDER BY a.checkin_at DESC LIMIT ?`,
      [canon, canon, a.id, a.eventId, ...(visible ? [visible] : []), DETAIL_OTHER_LIMIT],
    );
    return rows.map((r: any) => ({
      attendanceId: r.attendanceId, eventId: r.eventId, eventTitle: r.eventTitle, eventStartAt: r.eventStartAt, checkinAt: r.checkinAt,
      mssv: r.mssv, reviewStatus: r.reviewStatus, voided: Boolean(Number(r.voided)),
      drlAwarded: r.drlAwarded === null ? null : Number(r.drlAwarded),
    }));
  }

  // ---------- duyet ----------

  async reviewOne(actor: CurrentUser, id: string, dto: ReviewDto): Promise<AttendanceDto> {
    if (dto.status === 'REJECTED' && !dto.reason) throw Err.bad('REASON_REQUIRED', 'Từ chối lượt điểm danh phải nhập lý do.');
    const { before, after, started, eventId } = await this.ds.transaction(async (m) => {
      const { a, e } = await this.lockPair(m, actor, id);
      this.assertMutable(e);
      if (a.voidedAt) throw Err.conflict('ATTENDANCE_VOIDED', 'Lượt này đã bị hủy, hãy khôi phục trước khi duyệt.');
      const started = await this.review.startIfNeeded(m, e);
      const before = attendanceAuditView(a);
      this.applyReview(a, dto.status, dto.reason, actor.id);
      await m.save(a);
      return { before, after: attendanceAuditView(a), started, eventId: e.id };
    });
    if (started) await this.audit.log(actor, 'EVENT_REVIEW_START', 'event', eventId, {});
    await this.audit.log(actor, 'ATTENDANCE_REVIEW', 'attendance', id, { before, after, reason: dto.reason });
    return this.one(actor, id);
  }

  // [NV] 3.7: duyet / tu choi / huy nhieu luot; APPROVE_CLEAN = duyet moi luot cho duyet va khong co co
  async bulk(actor: CurrentUser, dto: BulkDto): Promise<{ updated: number; skipped: number }> {
    const needsReason = dto.action === 'REJECT' || dto.action === 'VOID';
    if (needsReason && !dto.reason) throw Err.bad('REASON_REQUIRED', 'Từ chối hoặc hủy hàng loạt phải nhập lý do.');
    const { updated, started } = await this.ds.transaction(async (m) => {
      const e = await this.events.lockScoped(m, actor, dto.eventId);
      this.assertMutable(e);
      const started = dto.action === 'VOID' ? false : await this.review.startIfNeeded(m, e);
      return { updated: await this.runBulk(m, e.id, dto, actor.id), started };
    });
    const requested = dto.ids?.length ?? updated;
    if (started) await this.audit.log(actor, 'EVENT_REVIEW_START', 'event', dto.eventId, {});
    await this.audit.log(actor, 'ATTENDANCE_BULK', 'event', dto.eventId, {
      after: { action: dto.action, updated, ids: dto.ids },
      reason: dto.reason,
    });
    return { updated, skipped: Math.max(0, requested - updated) };
  }

  // ---------- them / sua / huy ----------

  // [NV] 3.7, 5.3: them luot thu cong (vd. sinh vien that bi chan GPS); co MANUAL_ENTRY de minh bach
  async createManual(actor: CurrentUser, eventId: string, dto: ManualAttendanceDto): Promise<AttendanceDto> {
    const id = await this.ds.transaction(async (m) => {
      const e = await this.events.lockScoped(m, actor, eventId);
      this.assertMutable(e);
      return (await this.createManualIn(m, actor, e, dto, dto.reason)).id;
    });
    await this.audit.log(actor, 'ATTENDANCE_MANUAL_CREATE', 'attendance', id, { reason: dto.reason, after: { eventId } });
    return this.one(actor, id);
  }

  // Phan ghi cua "them thu cong", chay trong giao dich cua noi goi (da khoa su kien). Xu ly khieu nai cung dung.
  async createManualIn(m: EntityManager, actor: CurrentUser, e: Event, dto: ManualFieldsDto, reason: string): Promise<Attendance> {
    const mssv = await this.lookup.validMssv(dto.mssv);
    await this.lookup.assertFaculty(dto.facultyUnitId);
    await this.assertMssvFree(m, e.id, mssv, null);
    const checkinAt = dto.checkinAt ?? e.startAt;
    this.assertTimes(e, checkinAt, dto.checkoutAt ?? null);
    const row = m.create(Attendance, {
      id: randomUUID(), eventId: e.id, deviceId: null, mssv, fullName: dto.fullName, email: dto.email ?? null,
      facultyUnitId: dto.facultyUnitId, checkinAt, checkoutAt: dto.checkoutAt ?? null,
      timeliness: this.timeliness(e, checkinAt), lat: null, lng: null, gpsAccuracyM: null, distanceM: null,
      ip: null, userAgent: null, editCount: 0, source: 'MANUAL', reviewStatus: 'APPROVED', reviewedBy: actor.id,
      reviewedAt: new Date(), reviewNote: reason, drlAwarded: null, confirmCode: newConfirmCode(), idempotencyKey: null,
      checkoutIdempotencyKey: null, codeFailCount: 0, codeLockedUntil: null, voidedAt: null, voidReason: null,
    });
    await m.insert(Attendance, row);
    await m.query("INSERT IGNORE INTO attendance_flags (attendance_id, code, detail_json) VALUES (?, 'MANUAL_ENTRY', NULL)", [row.id]);
    await this.ensureStudent(m, row);
    return row;
  }

  async editOne(actor: CurrentUser, id: string, dto: EditAttendanceAdminDto): Promise<AttendanceDto> {
    const { before, after } = await this.ds.transaction(async (m) => {
      const { a, e } = await this.lockPair(m, actor, id);
      this.assertMutable(e);
      const before = attendanceAuditView(a);
      await this.applyEdit(m, e, a, dto);
      const after = attendanceAuditView(a);
      if (JSON.stringify(before) === JSON.stringify(after)) throw Err.bad('NO_CHANGES', 'Không có thông tin nào thay đổi.');
      await m.save(a);
      await m.insert(AttendanceEdit, {
        attendanceId: id, oldJson: before as any, newJson: after as any, actorType: 'ADMIN', actorId: actor.id,
        reason: dto.reason, idempotencyKey: null,
      });
      await this.ensureStudent(m, a);
      return { before, after };
    });
    await this.audit.log(actor, 'ATTENDANCE_EDIT', 'attendance', id, { before, after, reason: dto.reason });
    return this.one(actor, id);
  }

  // [NV] 3.7: du lieu diem danh khong xoa cung: "huy" co ly do, khoi phuc duoc (quay ve cho duyet)
  async setVoided(actor: CurrentUser, id: string, reason: string, voided: boolean): Promise<AttendanceDto> {
    const { before, after } = await this.ds.transaction(async (m) => {
      const { a, e } = await this.lockPair(m, actor, id);
      this.assertMutable(e);
      if (voided && a.voidedAt) throw Err.conflict('ALREADY_VOIDED', 'Lượt này đã bị hủy.');
      if (!voided && !a.voidedAt) throw Err.conflict('NOT_VOIDED', 'Lượt này chưa bị hủy.');
      const before = attendanceAuditView(a);
      if (voided) {
        a.voidedAt = new Date();
        a.voidReason = reason;
      } else {
        // [NV] 3.7: khoi phuc khong duoc tao hai luot cung MSSV trong mot su kien
        await this.assertMssvFree(m, e.id, a.mssv, a.id);
        a.voidedAt = null;
        a.voidReason = null;
        this.applyReview(a, 'PENDING', undefined, actor.id);
      }
      await m.save(a);
      return { before, after: attendanceAuditView(a) };
    });
    await this.audit.log(actor, voided ? 'ATTENDANCE_VOID' : 'ATTENDANCE_RESTORE', 'attendance', id, { before, after, reason });
    return this.one(actor, id);
  }

  // ---------- noi bo ----------

  // xem duoc su kien (manage hoac view); ngoai pham vi = 404
  private async readable(actor: CurrentUser, eventId: string): Promise<{ event: Event; access: 'manage' | 'view' }> {
    const event = await this.eventRepo.findOne({ where: { id: eventId } });
    const access = event ? await this.events.access(actor, event) : 'none';
    if (!event || access === 'none') throw Err.notFound('sự kiện');
    return { event, access };
  }

  // [NV] 2.4: nguoi chi-xem (khoa xem su kien cap truong) chi thay sinh vien thuoc pham vi khoa minh
  private async limitToFaculties(actor: CurrentUser, access: 'manage' | 'view', qb: { andWhere: (c: string, p?: object) => unknown }) {
    if (access === 'manage') return;
    const ids = (await this.scope.visibleUnitIds(actor)) ?? [];
    qb.andWhere('a.facultyUnitId IN (:...facultyIds)', { facultyIds: ids.length ? ids : [''] });
  }

  private async flagsOf(ids: string[]): Promise<Map<string, AttendanceFlag[]>> {
    const map = new Map<string, AttendanceFlag[]>();
    if (ids.length === 0) return map;
    const rows = await this.ds.getRepository(AttendanceFlag).find({ where: { attendanceId: In(ids) }, order: { id: 'ASC' } });
    for (const f of rows) map.set(f.attendanceId, [...(map.get(f.attendanceId) ?? []), f]);
    return map;
  }

  private async one(actor: CurrentUser, id: string): Promise<AttendanceDto> {
    const a = await this.repo.findOneOrFail({ where: { id }, relations: { faculty: true } });
    const { access } = await this.readable(actor, a.eventId);
    return toAttendanceDto(a, (await this.flagsOf([id])).get(id) ?? [], access === 'manage');
  }

  // Khoa su kien TRUOC roi moi khoa luot (cung thu tu voi thao tac hang loat) de khong deadlock.
  // [BM] luot khong ton tai hoac thuoc su kien ngoai pham vi deu tra 404 (lockScoped kiem tra pham vi).
  private async lockPair(m: EntityManager, actor: CurrentUser, id: string): Promise<{ a: Attendance; e: Event }> {
    const peek = await m.findOne(Attendance, { where: { id }, select: ['id', 'eventId'] });
    if (!peek) throw Err.notFound('lượt điểm danh');
    const e = await this.events.lockScoped(m, actor, peek.eventId);
    const a = await m.findOne(Attendance, { where: { id }, lock: { mode: 'pessimistic_write' } });
    if (!a) throw Err.notFound('lượt điểm danh');
    return { a, e };
  }

  // sua / them / huy chi khi su kien con "mo" ve mat du lieu
  // viaAppeal: khieu nai con han duoc sua ca su kien da chot (dac ta 3.6)
  assertMutable(e: Event, viaAppeal = false): void {
    if (e.archivedAt) throw Err.conflict('EVENT_ARCHIVED', 'Sự kiện đang được lưu trữ, hãy khôi phục trước.');
    if (e.status === 'CANCELLED') throw Err.conflict('EVENT_CANCELLED', 'Sự kiện đã hủy.');
    if (e.status === 'FINALIZED' && !viaAppeal) throw Err.conflict('EVENT_FINALIZED', 'Sự kiện đã chốt, cần Đoàn trường mở khóa mới thay đổi được.');
    if (e.status === 'DRAFT') throw Err.conflict('INVALID_STATE', 'Sự kiện còn là bản nháp, chưa có điểm danh.');
  }

  applyReview(a: Attendance, status: ReviewDto['status'], reason: string | undefined, actorId: string): void {
    a.reviewStatus = status;
    if (status === 'PENDING') {
      a.reviewedBy = null;
      a.reviewedAt = null;
      a.reviewNote = null;
      return;
    }
    a.reviewedBy = actorId;
    a.reviewedAt = new Date();
    a.reviewNote = reason ?? null;
  }

  private async runBulk(m: EntityManager, eventId: string, dto: BulkDto, actorId: string): Promise<number> {
    const now = new Date();
    const ids = dto.ids ?? [];
    let res: { affectedRows: number };
    if (dto.action === 'VOID') {
      res = await m.query(
        'UPDATE attendances SET voided_at = ?, void_reason = ? WHERE event_id = ? AND id IN (?) AND voided_at IS NULL',
        [now, dto.reason, eventId, ids],
      );
    } else if (dto.action === 'APPROVE_CLEAN') {
      res = await m.query(
        `UPDATE attendances SET review_status = 'APPROVED', reviewed_by = ?, reviewed_at = ?, review_note = NULL
          WHERE event_id = ? AND review_status = 'PENDING' AND voided_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM attendance_flags fl WHERE fl.attendance_id = attendances.id)`,
        [actorId, now, eventId],
      );
    } else {
      const status = dto.action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      res = await m.query(
        'UPDATE attendances SET review_status = ?, reviewed_by = ?, reviewed_at = ?, review_note = ? WHERE event_id = ? AND id IN (?) AND voided_at IS NULL',
        [status, actorId, now, dto.action === 'REJECT' ? dto.reason : null, eventId, ids],
      );
    }
    return res.affectedRows;
  }

  // [NV] 3.7: trong mot su kien khong co hai luot cung MSSV (tru luot da huy)
  async assertMssvFree(m: EntityManager, eventId: string, mssv: string, exceptId: string | null): Promise<void> {
    const rows = await m.query(
      'SELECT id FROM attendances WHERE event_id = ? AND mssv = ? AND voided_at IS NULL AND id <> ? LIMIT 1',
      [eventId, mssv, exceptId ?? ''],
    );
    if (rows.length > 0) {
      throw Err.conflict('DUPLICATE_MSSV', 'MSSV này đã có lượt điểm danh trong sự kiện. Hãy sửa lượt đó hoặc hủy nó trước.');
    }
  }

  // checkWindow=false khi khong doi gio vao: luot that co the diem danh ngoai khung (QTV bam tay mo) nen khong kiem lai
  private assertTimes(e: Event, checkinAt: Date, checkoutAt: Date | null, checkWindow = true): void {
    if (checkWindow && (checkinAt < e.checkinOpenAt || checkinAt > e.checkinCloseAt)) {
      throw Err.bad('CHECKIN_OUT_OF_RANGE', 'Giờ điểm danh vào phải nằm trong khung giờ mở điểm danh của sự kiện.');
    }
    if (checkoutAt === null) return;
    if (!e.requireCheckout) throw Err.bad('CHECKOUT_DISABLED', 'Sự kiện này không có điểm danh ra.');
    if (checkoutAt < checkinAt) throw Err.bad('INVALID_CHECKOUT', 'Giờ điểm danh ra phải sau giờ điểm danh vào.');
  }

  // [NV] 3.1: dung gio neu diem danh truoc gio bat dau + an han
  private timeliness(e: Event, at: Date): 'ON_TIME' | 'LATE' {
    return at.getTime() <= e.startAt.getTime() + e.graceMinutes * 60_000 ? 'ON_TIME' : 'LATE';
  }

  private async applyEdit(m: EntityManager, e: Event, a: Attendance, dto: EditAttendanceAdminDto): Promise<void> {
    if (dto.mssv !== undefined) {
      const mssv = await this.lookup.validMssv(dto.mssv);
      if (mssv !== a.mssv) {
        await this.assertMssvFree(m, e.id, mssv, a.id);
        a.mssv = mssv;
      }
    }
    if (dto.fullName !== undefined) a.fullName = dto.fullName;
    if (dto.facultyUnitId !== undefined && dto.facultyUnitId !== a.facultyUnitId) {
      await this.lookup.assertFaculty(dto.facultyUnitId);
      a.facultyUnitId = dto.facultyUnitId;
    }
    if (dto.email !== undefined) a.email = dto.email;
    if (dto.checkinAt !== undefined) {
      a.checkinAt = dto.checkinAt;
      a.timeliness = this.timeliness(e, dto.checkinAt);
    }
    if (dto.checkoutAt !== undefined) a.checkoutAt = dto.checkoutAt;
    this.assertTimes(e, a.checkinAt, a.checkoutAt, dto.checkinAt !== undefined);
  }

  private ensureStudent(m: EntityManager, a: Attendance): Promise<unknown> {
    return m.query(
      `INSERT INTO students (mssv, full_name_latest, faculty_unit_id, first_seen_at, merged_into) VALUES (?, ?, ?, ?, NULL)
       ON DUPLICATE KEY UPDATE
         full_name_latest = IF(\`profile_locked\`, \`full_name_latest\`, VALUES(\`full_name_latest\`)),
         faculty_unit_id = IF(\`profile_locked\`, \`faculty_unit_id\`, VALUES(\`faculty_unit_id\`))`,
      [a.mssv, a.fullName, a.facultyUnitId, a.checkinAt],
    );
  }
}
