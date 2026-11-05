// Dinh dang thoi gian + nhan trang thai su kien (mau theo chot-giao-dien.md muc 2)
import type { CheckinState, EventStatus } from './api';

export const fmt = (iso: string) =>
  new Date(iso).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });

const STATUS: Record<EventStatus, [string, string]> = {
  DRAFT: ['Nháp', 'draft'],
  PUBLISHED: ['Đã công bố', 'info'],
  CHECKIN_OPEN: ['Đang điểm danh', 'ok'],
  CHECKIN_CLOSED: ['Đã đóng điểm danh', 'draft'],
  REVIEWING: ['Chờ duyệt', 'wait'],
  FINALIZED: ['Hoàn tất', 'ok'],
  CANCELLED: ['Đã hủy', 'err'],
};

// [NV] 3.1: PUBLISHED = tu dong theo khung gio, nen nhan phai xet checkinState truoc (dang mo / da dong that su)
export function eventBadge(status: EventStatus, checkinState?: CheckinState, archived = false): [string, string] {
  if (archived) return ['Lưu trữ', 'draft'];
  if (status === 'PUBLISHED' && checkinState === 'OPEN') return ['Đang điểm danh', 'ok'];
  if (status === 'PUBLISHED' && checkinState === 'CLOSED') return ['Đã đóng điểm danh', 'draft'];
  return STATUS[status];
}

export function StatusBadge({ status, checkinState, archived }: { status: EventStatus; checkinState?: CheckinState; archived?: boolean }) {
  const [label, tone] = eventBadge(status, checkinState, archived);
  return <span className={`badge ${tone}`}>{label}</span>;
}

// <input type="datetime-local"> (gio may) -> ISO 8601 co mui gio, dung dinh dang API yeu cau
export const toIso = (local: string) => new Date(local).toISOString();

export const FLAG_LABEL: Record<string, string> = {
  DUPLICATE_MSSV: 'Trùng MSSV',
  DEVICE_MULTI_MSSV: 'Thiết bị dùng cho nhiều MSSV',
  MSSV_MULTI_DEVICE: 'MSSV dùng nhiều thiết bị',
  NAME_MISMATCH: 'Tên khác lần trước',
  FACULTY_MISMATCH: 'Khoa khác lần trước',
  NEW_DEVICE: 'Thiết bị mới',
  DUES_UNPAID: 'Chưa đóng đoàn phí - hội phí',
  BURST_SAME_FINGERPRINT: 'Nhiều MSSV cùng máy',
  GPS_OUTSIDE: 'Ngoài vùng GPS',
  GPS_LOW_ACCURACY: 'GPS kém chính xác',
  GPS_MISSING: 'Không có GPS',
  NO_CHECKOUT: 'Chưa điểm danh ra',
  MANUAL_ENTRY: 'Thêm thủ công',
};

export const REVIEW_LABEL: Record<string, [string, string]> = {
  PENDING: ['Chờ duyệt', 'wait'],
  APPROVED: ['Đã duyệt', 'ok'],
  REJECTED: ['Từ chối', 'err'],
};

export const APPEAL_TYPE_LABEL: Record<string, string> = {
  WRONG_INFO: 'Sai thông tin',
  NO_CHECKIN: 'Có tham gia nhưng không điểm danh được',
  PROXY_CHECKIN: 'Bị điểm danh hộ',
  DUPLICATE_MSSV: 'Trùng MSSV',
};

// ISO -> gia tri cho <input type="datetime-local"> theo gio may
export function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export const ROLE_LABEL: Record<string, string> = { SCHOOL_ADMIN: 'Quản trị Đoàn trường', FACULTY_MANAGER: 'Quản lý khoa' };

// so thay doi so voi ky truoc: "+12%", "-5%", "mới" (ky truoc = 0), "—" (khong co du lieu)
export function delta(value: number, previous: number): { text: string; tone: 'up' | 'down' | 'flat' } {
  if (previous === 0) return value === 0 ? { text: '—', tone: 'flat' } : { text: 'mới', tone: 'up' };
  const pct = Math.round(((value - previous) / previous) * 100);
  return { text: `${pct > 0 ? '+' : ''}${pct}%`, tone: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat' };
}

// ngay YYYY-MM-DD (gio Viet Nam) cua mot moc thoi gian
export const vnDay = (ms: number) => new Date(ms + 7 * 3600_000).toISOString().slice(0, 10);

export const dmy = (day: string) => day.split('-').reverse().join('/');

// ---------- hoat dong (giai doan 6) ----------
export const ACTIVITY_STATUS: Record<string, [string, string]> = {
  DRAFT: ['Nháp', 'draft'],
  PENDING_PLAN: ['Chờ duyệt kế hoạch', 'wait'],
  IN_PROGRESS: ['Đang triển khai', 'info'],
  PENDING_EVAL: ['Chờ đánh giá', 'wait'],
  EVALUATED: ['Đã đánh giá', 'ok'],
  LOCKED: ['Đã chốt', 'ok'],
};
export const ACTIVITY_STEPS = ['DRAFT', 'PENDING_PLAN', 'IN_PROGRESS', 'PENDING_EVAL', 'EVALUATED', 'LOCKED'] as const;
export const EVALUATION_LABEL: Record<string, [string, string]> = { COMPLETED: ['Hoàn thành', 'ok'], NOT_COMPLETED: ['Chưa hoàn thành', 'err'] };
export const REWARD_LABEL: Record<string, [string, string]> = { APPROVED: ['Được khen thưởng', 'ok'], REJECTED: ['Không khen thưởng', 'draft'] };
export const LINK_GROUP_LABEL: Record<string, string> = { MEDIA: 'Sản phẩm truyền thông', PUBLICATION: 'Bài đăng / tin bài', RESULT: 'Báo cáo kết quả' };
export const LINK_TYPE_LABEL: Record<string, string> = { FACEBOOK: 'Facebook', VIDEO: 'Video', PHOTO: 'Hình ảnh', INFOGRAPHIC: 'Infographic', NEWS: 'Tin bài', OTHER: 'Khác' };
export const LEVEL_LABEL: Record<string, string> = { SCHOOL: 'Cấp trường', FACULTY: 'Cấp khoa', CLASS: 'Cấp lớp' };
export const MODE_LABEL: Record<string, string> = { ONSITE: 'Trực tiếp', ONLINE: 'Trực tuyến', HYBRID: 'Kết hợp' };
export const WORKFLOW_LABEL: Record<string, string> = {
  SUBMIT: 'Nộp kế hoạch', APPROVE: 'Duyệt kế hoạch', RETURN: 'Trả lại bổ sung', SUBMIT_RESULT: 'Nộp kết quả',
  EVALUATE: 'Đánh giá', REWARD: 'Xét khen thưởng', REOPEN: 'Mở lại hồ sơ',
};
export const FIELD_LABEL: Record<string, string> = {
  name: 'Tên hoạt động', startAt: 'Bắt đầu', endAt: 'Kết thúc', location: 'Địa điểm', mode: 'Hình thức', level: 'Cấp tổ chức',
  targetAudience: 'Đối tượng', expectedCount: 'Dự kiến', manualCount: 'Thực tế (nhập tay)', budgetPlanned: 'Kinh phí dự kiến',
  budgetActual: 'Kinh phí thực tế', ownerName: 'Người phụ trách', ownerPhone: 'SĐT phụ trách', planUrl: 'Link kế hoạch', note: 'Ghi chú',
  categoryId: 'Lĩnh vực', links: 'Link sản phẩm', coUnitIds: 'Đơn vị phối hợp', academicYearId: 'Năm học',
};

export function ActivityBadge({ status }: { status: string }) {
  const [label, tone] = ACTIVITY_STATUS[status] ?? [status, 'draft'];
  return <span className={`badge ${tone}`}>{label}</span>;
}

export const vnd = (n: number | null) => (n === null ? '—' : `${n.toLocaleString('vi-VN')} đ`);

// Canh bao do cho thiet bi bi gan co DEVICE_MULTI_MSSV (diem danh ho) - hien tren trang diem danh va trang lich su cua sinh vien
export function ProxyAlert() {
  return (
    <div className="proxy-alert" role="alert">
      ⚠ Phát hiện thiết bị đang điểm danh hộ. Vui lòng liên hệ BTC chương trình.
    </div>
  );
}

// Canh bao do chua dong doan phi - hoi phi; noi dung do QTV soan (cau hinh dues_warning_message)
export function DuesAlert({ message }: { message: string }) {
  return (
    <div className="proxy-alert" role="alert">
      ⚠ {message}
    </div>
  );
}
