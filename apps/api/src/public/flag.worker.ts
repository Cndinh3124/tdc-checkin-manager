// Worker nen: danh gia luat gan co cho luot diem danh - dac ta 5.3; chot-backend-hieu-nang.md muc 1
// Doc hang doi attendance_jobs trong DB. Nhieu ban backend cung chay duoc vi lay viec bang SKIP LOCKED.
// Co chi them, khong tu xoa: sua thong tin co the them co moi, nguoi duyet (giai doan 4) quyet dinh bo qua hay khong.
import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Inject } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { APP_ENV } from '../config/app-config.module';
import { AppEnv } from '../config/env';
import { Event } from '../events/entities/event.entity';
import { SettingsService } from '../settings/settings.service';
import { Attendance } from './entities/attendance.entity';
import { FlagCode } from './entities/attendance-flag.entity';
import { Device } from './entities/device.entity';
import { findBurst, haversineM, isSimilar, levenshtein, normalizeName } from './flag-rules';
import { GPS_LOW_ACCURACY_M } from './public.constants';

interface Job {
  id: string;
  attendanceId: string;
  attempts: number;
  payload: { newDevice?: boolean } | null;
}

type Raise = (attendanceId: string, code: FlagCode, detail?: Record<string, unknown>) => void;

const BATCH = 50;
const VISIBILITY_MS = 60_000; // worker sap giua chung thi sau ngan nay viec tu hien lai
const MAX_ATTEMPTS = 5;
const POLL_MS = 1000;
// moi nhip xu ly lien tiep toi da ngan nay lo (500 viec) de theo kip dot dinh 100 luot/giay; qua do thi nhip sau lam tiep
const ROUNDS_PER_TICK = 10;

@Injectable()
export class FlagWorker implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('FlagWorker');
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<unknown> = Promise.resolve();
  private stopped = false;

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly settings: SettingsService,
  ) {}

  onModuleInit(): void {
    if (!this.env.flagWorkerEnabled) return;
    this.timer = setInterval(() => {
      this.running = this.running.then(() => this.drain(ROUNDS_PER_TICK)).catch(() => undefined);
    }, POLL_MS);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }

  // Xu ly het viec dang cho (toi da maxRounds lan lay lo). Test goi truc tiep. Tra so viec da lam.
  async drain(maxRounds = 1000): Promise<number> {
    let total = 0;
    for (let i = 0; i < maxRounds && !this.stopped; i++) {
      const jobs = await this.claim();
      if (jobs.length === 0) break;
      for (const j of jobs) {
        await this.runJob(j);
        total++;
      }
    }
    return total;
  }

  // "Nhan" viec: day run_at ve sau; giu khoa dong chi trong luc nhan
  private async claim(): Promise<Job[]> {
    return this.ds.transaction(async (m) => {
      const now = new Date();
      const rows = await m.query(
        `SELECT id, attendance_id AS attendanceId, attempts, payload_json AS payload FROM attendance_jobs
          WHERE status = 'PENDING' AND run_at <= ? ORDER BY id LIMIT ${BATCH} FOR UPDATE SKIP LOCKED`,
        [now],
      );
      if (rows.length === 0) return [];
      const ids = rows.map((r: Job) => r.id);
      await m.query(
        `UPDATE attendance_jobs SET run_at = ?, attempts = attempts + 1 WHERE id IN (${ids.map(() => '?').join(',')})`,
        [new Date(now.getTime() + VISIBILITY_MS), ...ids],
      );
      return rows.map((r: Job) => ({
        ...r,
        attempts: Number(r.attempts) + 1,
        payload: typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload,
      }));
    });
  }

  private async runJob(job: Job): Promise<void> {
    try {
      await this.evaluate(job);
      await this.ds.query("UPDATE attendance_jobs SET status = 'DONE' WHERE id = ?", [job.id]);
    } catch (e: any) {
      // [BM] chi ghi ma loi: thong bao cua MySQL co the chua gia tri du lieu (MSSV...)
      this.log.error(`Viec ${job.id} loi (lan ${job.attempts}): ${e?.code ?? e?.name ?? 'UNKNOWN'}`);
      const failed = job.attempts >= MAX_ATTEMPTS;
      await this.ds.query('UPDATE attendance_jobs SET status = ?, run_at = ? WHERE id = ?', [
        failed ? 'FAILED' : 'PENDING', new Date(Date.now() + job.attempts * 5000), job.id,
      ]);
    }
  }

  private async evaluate(job: Job): Promise<void> {
    const att = await this.ds.getRepository(Attendance).findOne({ where: { id: job.attendanceId } });
    if (!att || att.voidedAt) return;
    const event = await this.ds.getRepository(Event).findOneByOrFail({ id: att.eventId });
    const device = att.deviceId ? await this.ds.getRepository(Device).findOne({ where: { id: att.deviceId } }) : null;

    const flags: Array<[string, FlagCode, Record<string, unknown> | undefined]> = [];
    const raise: Raise = (id, code, detail) => flags.push([id, code, detail]);
    if (job.payload?.newDevice) raise(att.id, 'NEW_DEVICE');
    await this.geoFlags(att, event, raise);
    await this.duplicateFlags(att, raise);
    await this.deviceFlags(att, raise);
    await this.historyFlags(att, raise);
    await this.burstFlags(att, device, raise);
    await this.duesFlags(att, raise);

    for (const [id, code, detail] of flags) {
      await this.ds.query('INSERT IGNORE INTO attendance_flags (attendance_id, code, detail_json) VALUES (?, ?, ?)', [
        id, code, detail ? JSON.stringify(detail) : null,
      ]);
    }
    await this.upsertStudent(att);
  }

  // [NV] 5.3: GPS_*; chi xet khi su kien co toa do. [BM] detail khong chua toa do.
  private async geoFlags(att: Attendance, event: Event, raise: Raise): Promise<void> {
    if (event.latitude === null || event.longitude === null || event.radiusM === null) return;
    if (att.lat === null || att.lng === null) return raise(att.id, 'GPS_MISSING');
    const distance = haversineM(att.lat, att.lng, event.latitude, event.longitude);
    await this.ds.query('UPDATE attendances SET distance_m = ? WHERE id = ?', [distance, att.id]);
    if (att.gpsAccuracyM !== null && att.gpsAccuracyM > GPS_LOW_ACCURACY_M) {
      raise(att.id, 'GPS_LOW_ACCURACY', { accuracyM: att.gpsAccuracyM });
    }
    if (distance > event.radiusM) raise(att.id, 'GPS_OUTSIDE', { distanceM: distance, radiusM: event.radiusM });
  }

  // [NV] 5.3 DUPLICATE_MSSV: cung MSSV tu thiet bi khac trong su kien -> gan co CA HAI luot, khong tu choi nguoi den sau
  private async duplicateFlags(att: Attendance, raise: Raise): Promise<void> {
    const others = await this.ds.query(
      'SELECT id FROM attendances WHERE event_id = ? AND mssv = ? AND id <> ? AND voided_at IS NULL',
      [att.eventId, att.mssv, att.id],
    );
    if (others.length === 0) return;
    raise(att.id, 'DUPLICATE_MSSV', { count: others.length + 1 });
    for (const o of others) raise(o.id, 'DUPLICATE_MSSV', { count: others.length + 1 });
  }

  // [NV] 5.3 MSSV_MULTI_DEVICE (da gan thiet bi khac TRUOC do) va DEVICE_MULTI_MSSV (thiet bi tung gan MSSV khac).
  // Moc "truoc do" lay theo cap MSSV/thiet bi nen ket qua khong phu thuoc thu tu chay viec.
  private async deviceFlags(att: Attendance, raise: Raise): Promise<void> {
    if (!att.deviceId) return;
    const [bind] = await this.ds.query('SELECT first_seen_at AS at FROM student_devices WHERE mssv = ? AND device_id = ?', [att.mssv, att.deviceId]);
    const mine = bind ? new Date(bind.at) : att.checkinAt;
    const earlier = await this.ds.query(
      'SELECT 1 FROM student_devices WHERE mssv = ? AND device_id <> ? AND first_seen_at < ? LIMIT 1',
      [att.mssv, att.deviceId, mine],
    );
    if (earlier.length) raise(att.id, 'MSSV_MULTI_DEVICE');

    const days = await this.settings.get<number>('device_mssv_window_days');
    const since = new Date(att.checkinAt.getTime() - days * 86_400_000);
    const others: Array<{ mssv: string }> = await this.ds.query(
      'SELECT mssv FROM student_devices WHERE device_id = ? AND mssv <> ? AND first_seen_at >= ? AND first_seen_at <= ?',
      [att.deviceId, att.mssv, since, att.checkinAt],
    );
    // lech <= 2 ky tu la go nham, khong tinh la MSSV khac han
    if (others.some((o) => levenshtein(o.mssv, att.mssv) > 2)) raise(att.id, 'DEVICE_MULTI_MSSV');
  }

  // [NV] MSSV nam trong danh sach chua dong doan phi - hoi phi: chi gan co, nguoi duyet tu quyet dinh diem ren luyen
  private async duesFlags(att: Attendance, raise: Raise): Promise<void> {
    const rows = await this.ds.query('SELECT 1 FROM dues_unpaid WHERE mssv = ? LIMIT 1', [att.mssv]);
    if (rows.length) raise(att.id, 'DUES_UNPAID');
  }

  // [NV] 5.3 NAME_MISMATCH / FACULTY_MISMATCH: so voi luot gan nhat truoc do cua cung MSSV
  private async historyFlags(att: Attendance, raise: Raise): Promise<void> {
    const prev = await this.ds.getRepository(Attendance)
      .createQueryBuilder('a')
      .where('a.mssv = :mssv AND a.id <> :id AND a.checkinAt < :at AND a.voidedAt IS NULL', {
        mssv: att.mssv, id: att.id, at: att.checkinAt,
      })
      .orderBy('a.checkinAt', 'DESC')
      .getOne();
    if (!prev) return;
    if (!isSimilar(normalizeName(prev.fullName), normalizeName(att.fullName))) raise(att.id, 'NAME_MISMATCH');
    if (prev.facultyUnitId !== att.facultyUnitId) raise(att.id, 'FACULTY_MISMATCH');
  }

  // [NV] 5.3 BURST_SAME_FINGERPRINT: >= 3 MSSV trong 60 giay cung fingerprint + cung IP
  private async burstFlags(att: Attendance, device: Device | null, raise: Raise): Promise<void> {
    if (!device?.fingerprintHash || !att.ip) return;
    const rows: Array<{ id: string; mssv: string; at: Date }> = await this.ds.query(
      `SELECT a.id, a.mssv, a.checkin_at AS at FROM attendances a JOIN devices d ON d.id = a.device_id
        WHERE a.event_id = ? AND a.ip = ? AND d.fingerprint_hash = ? AND a.voided_at IS NULL
          AND a.checkin_at BETWEEN ? AND ?`,
      [att.eventId, att.ip, device.fingerprintHash, new Date(att.checkinAt.getTime() - 120_000), new Date(att.checkinAt.getTime() + 120_000)],
    );
    const ids = findBurst(rows.map((r) => ({ id: r.id, mssv: r.mssv, at: new Date(r.at).getTime() })), att.id);
    for (const id of ids) raise(id, 'BURST_SAME_FINGERPRINT');
  }

  private async upsertStudent(att: Attendance): Promise<void> {
    await this.ds.query(
      `INSERT INTO students (mssv, full_name_latest, faculty_unit_id, first_seen_at, merged_into) VALUES (?, ?, ?, ?, NULL)
       ON DUPLICATE KEY UPDATE
         full_name_latest = IF(\`profile_locked\`, \`full_name_latest\`, VALUES(\`full_name_latest\`)),
         faculty_unit_id = IF(\`profile_locked\`, \`faculty_unit_id\`, VALUES(\`faculty_unit_id\`))`,
      [att.mssv, att.fullName, att.facultyUnitId, att.checkinAt],
    );
  }
}
