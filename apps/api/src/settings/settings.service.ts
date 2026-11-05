// Cau hinh he thong - dac ta 6 (system_settings), 3.8 (mssv_regex)
// Chi cho sua cac khoa da khai bao, moi khoa co bo kiem tra gia tri rieng.
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { CurrentUser } from '../common/current-user';
import { Err } from '../common/errors';
import { SystemSetting } from './entities/system-setting.entity';

type Validator = (v: unknown) => unknown;

const int = (label: string, min: number, max: number): Validator => (v) => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw Err.bad('INVALID_SETTING', `${label} phải là số nguyên từ ${min} đến ${max}.`);
  }
  return v;
};

// [BM] bieu thuc MSSV do QTV nhap chay tren du lieu nguoi dung -> chan mau de gay ReDoS
const mssvRegex: Validator = (v) => {
  if (typeof v !== 'string' || v.length < 1 || v.length > 200) {
    throw Err.bad('INVALID_SETTING', 'Biểu thức MSSV phải là chuỗi từ 1 đến 200 ký tự.');
  }
  if (/\([^)]*[+*][^)]*\)[+*{]/.test(v)) {
    throw Err.bad('INVALID_SETTING', 'Biểu thức MSSV có lặp lồng nhau, không được phép.');
  }
  let re: RegExp;
  try {
    re = new RegExp(v);
  } catch {
    throw Err.bad('INVALID_SETTING', 'Biểu thức MSSV không hợp lệ.');
  }
  // [NV] 3.8: phai khop mau da chot, de khong vo tinh khoa het sinh vien
  if (!re.test('24211TM1152')) {
    throw Err.bad('INVALID_SETTING', 'Biểu thức MSSV phải khớp mã mẫu 24211TM1152.');
  }
  return v;
};

const duesMessage: Validator = (v) => {
  if (typeof v !== 'string' || v.trim().length < 1 || v.length > 500) {
    throw Err.bad('INVALID_SETTING', 'Nội dung cảnh báo phải từ 1 đến 500 ký tự.');
  }
  return v.trim();
};

export const SETTING_RULES: Record<string, Validator> = {
  mssv_regex: mssvRegex,
  appeal_days: int('Số ngày khiếu nại', 1, 60),
  default_open_before_min: int('Số phút mở điểm danh trước giờ', 0, 240),
  default_grace_min: int('Số phút ân hạn', 0, 120),
  data_retention_months: int('Số tháng lưu dữ liệu vị trí', 1, 60),
  dues_warning_message: duesMessage,
  device_mssv_window_days: int('Số ngày xét thiết bị gắn nhiều MSSV', 1, 730),
};

@Injectable()
export class SettingsService {
  private cache = new Map<string, { value: unknown; at: number }>();

  constructor(
    @InjectRepository(SystemSetting) private readonly repo: Repository<SystemSetting>,
    private readonly audit: AuditService,
  ) {}

  async getAll(): Promise<Record<string, unknown>> {
    const rows = await this.repo.find();
    return Object.fromEntries(rows.map((r) => [r.key, r.valueJson]));
  }

  // dung cho cac module khac (giai doan sau); cache 30 giay de khong truy van DB moi lan
  async get<T = unknown>(key: string): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < 30_000) return hit.value as T;
    const row = await this.repo.findOne({ where: { key } });
    if (!row) throw Err.notFound('cấu hình');
    this.cache.set(key, { value: row.valueJson, at: Date.now() });
    return row.valueJson as T;
  }

  async update(actor: CurrentUser, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
    const keys = Object.keys(patch);
    if (keys.length === 0) throw Err.bad('INVALID_SETTING', 'Chưa có cấu hình nào để cập nhật.');
    // B1: kiem tra het truoc khi ghi bat ky khoa nao
    const clean: Record<string, unknown> = {};
    for (const k of keys) {
      const rule = SETTING_RULES[k];
      if (!rule) throw Err.bad('UNKNOWN_SETTING', `Cấu hình "${k.slice(0, 50)}" không tồn tại.`);
      clean[k] = rule(patch[k]);
    }
    // B2: ghi + nhat ky (truoc / sau)
    const before = await this.getAll();
    for (const [k, v] of Object.entries(clean)) {
      await this.repo.save({ key: k, valueJson: v, updatedBy: actor.id });
      this.cache.delete(k);
    }
    const after = await this.getAll();
    await this.audit.log(actor, 'SETTINGS_UPDATE', 'settings', null, {
      before: pick(before, keys),
      after: pick(after, keys),
    });
    return after;
  }
}

function pick(o: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.map((k) => [k, o[k]]));
}
