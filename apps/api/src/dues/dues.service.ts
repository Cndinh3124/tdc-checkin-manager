// Danh sach chua dong doan phi - hoi phi: tai len thay the toan bo, gan co DUES_UNPAID cho luot diem danh da co
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { CurrentUser } from '../common/current-user';
import { Err } from '../common/errors';
import { normalizeMssv } from '../public/flag-rules';
import { PublicLookupService } from '../public/public-lookup.service';

const MAX_ROWS = 20_000;
const CHUNK = 1000;

@Injectable()
export class DuesService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly lookup: PublicLookupService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<{ total: number; mssvs: string[] }> {
    const rows: Array<{ mssv: string }> = await this.ds.query('SELECT mssv FROM dues_unpaid ORDER BY mssv');
    return { total: rows.length, mssvs: rows.map((r) => r.mssv) };
  }

  // [NV] thay the toan bo danh sach. Co da gan thi giu nguyen (co chi them, khong tu xoa).
  async replace(actor: CurrentUser, raw: unknown): Promise<{ total: number; flagged: number }> {
    if (!Array.isArray(raw)) throw Err.bad('INVALID_DUES', 'Danh sách MSSV phải là một mảng.');
    if (raw.length > MAX_ROWS) throw Err.bad('INVALID_DUES', `Danh sách tối đa ${MAX_ROWS} MSSV.`);
    const re = await this.lookup.mssvRegex();
    const set = new Set<string>();
    const bad: string[] = [];
    for (const r of raw) {
      const m = typeof r === 'string' ? normalizeMssv(r) : '';
      if (m.length > 0 && m.length <= 20 && re.test(m)) set.add(m);
      else if (bad.length < 10) bad.push(typeof r === 'string' ? r.slice(0, 20) : String(r).slice(0, 20));
    }
    if (bad.length > 0) throw Err.bad('INVALID_MSSV', `Có MSSV không đúng định dạng: ${bad.join(', ')}.`);
    const mssvs = [...set];

    const before = (await this.list()).total;
    const flagged = await this.ds.transaction(async (m) => {
      await m.query('DELETE FROM dues_unpaid');
      for (let i = 0; i < mssvs.length; i += CHUNK) {
        const part = mssvs.slice(i, i + CHUNK);
        await m.query(
          `INSERT INTO dues_unpaid (mssv, created_by) VALUES ${part.map(() => '(?, ?)').join(',')}`,
          part.flatMap((s) => [s, actor.id]),
        );
      }
      const res = await m.query(
        `INSERT IGNORE INTO attendance_flags (attendance_id, code, detail_json)
         SELECT a.id, 'DUES_UNPAID', NULL FROM attendances a JOIN dues_unpaid d ON d.mssv = a.mssv WHERE a.voided_at IS NULL`,
      );
      return Number(res?.affectedRows ?? 0);
    });
    // [BM] nhat ky chi ghi so luong, khong ghi danh sach MSSV
    await this.audit.log(actor, 'DUES_UNPAID_REPLACE', 'dues_unpaid', null, { before: { total: before }, after: { total: mssvs.length, flagged } });
    return { total: mssvs.length, flagged };
  }
}
