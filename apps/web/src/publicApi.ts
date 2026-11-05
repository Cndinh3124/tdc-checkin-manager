// Client cho API cong khai /api/public (khong can dang nhap). Dac ta 3.3, 4, 7.
// Ma thiet bi: cookie httpOnly la chinh; ban sao trong localStorage gui lai qua header khi cookie bi xoa (server van kiem chu ky).

const DEVICE_KEY = 'tdc_device_token';

export class PublicError extends Error {
  constructor(public status: number, public code: string, message: string, public body?: any) {
    super(message);
  }
}

export interface Faculty {
  id: string;
  name: string;
  code: string;
}

export interface Ticket {
  id: string;
  mssv: string;
  fullName: string;
  email: string | null;
  facultyUnitId: string;
  checkinAt: string;
  checkoutAt: string | null;
  timeliness: 'ON_TIME' | 'LATE';
  confirmCode: string;
  editsLeft: number;
  canEdit: boolean;
}

export interface TokenInfo {
  event: {
    title: string;
    description: string | null;
    locationName: string | null;
    startAt: string;
    endAt: string;
    checkinOpenAt: string;
    checkinCloseAt: string;
    requiresGps: boolean;
    requireCheckout: boolean;
  };
  purpose: 'CHECKIN' | 'CHECKOUT';
  state: 'OPEN' | 'NOT_YET' | 'CLOSED' | 'NOT_AVAILABLE';
  verifyCodeRequired: boolean;
  appeal: { open: boolean; deadlineAt: string };
  mssvRegex: string;
  attendance: Ticket | null;
  prefill: { mssv: string; fullName: string; facultyUnitId: string; email: string | null } | null;
  deviceToken: string;
  proxyWarning: boolean;
  duesWarning: string | null;
}

export interface Position {
  lat: number;
  lng: number;
  accuracyM: number;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const stored = localStorage.getItem(DEVICE_KEY);
  if (stored) headers['x-device-token'] = stored;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`/api/public${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new PublicError(0, 'NETWORK', 'Mất kết nối mạng. Hãy kiểm tra mạng rồi bấm thử lại.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new PublicError(res.status, data?.code ?? 'ERROR', data?.message ?? 'Có lỗi xảy ra, vui lòng thử lại.', data);
  return data as T;
}

export async function loadToken(token: string): Promise<TokenInfo> {
  const info = await call<TokenInfo>('GET', `/events/by-token/${encodeURIComponent(token)}`);
  localStorage.setItem(DEVICE_KEY, info.deviceToken);
  return info;
}

export const loadFaculties = () => call<Faculty[]>('GET', '/units');

export interface CheckinInput {
  token: string;
  idempotencyKey: string;
  mssv: string;
  fullName: string;
  facultyUnitId: string;
  email?: string;
  lat?: number;
  lng?: number;
  accuracyM?: number;
}

export const checkin = (input: CheckinInput) => call<{ attendance: Ticket }>('POST', '/checkin', input);

export const checkout = (input: { token: string; idempotencyKey: string; verifyCode?: string } & Partial<Position>) =>
  call<{ attendance: Ticket }>('POST', '/checkout', input);

export const editTicket = (id: string, body: Record<string, unknown>) => call<{ attendance: Ticket }>('PATCH', `/attendances/${id}`, body);

// uuid v4: crypto.randomUUID chi co o ngu canh bao mat (https / localhost), nen tu dung getRandomValues
export function uuid4(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// Chi goi khi sinh vien bam diem danh (dac ta 8.7: chi xin quyen vi tri luc can)
export function getPosition(): Promise<Position> {
  return new Promise((resolve, reject) => {
    const fail = (code: string, msg: string) => reject(new PublicError(0, code, msg));
    if (!navigator.geolocation) {
      return fail('GPS_UNSUPPORTED', 'Thiết bị không hỗ trợ định vị. Hãy dùng điện thoại và mở bằng liên kết https.');
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy }),
      (e) =>
        e.code === e.PERMISSION_DENIED
          ? fail('GPS_DENIED', 'Bạn chưa cho phép truy cập vị trí. Hãy bật quyền vị trí cho trình duyệt (Cài đặt → Quyền riêng tư → Vị trí) rồi thử lại.')
          : fail('GPS_UNAVAILABLE', 'Không lấy được vị trí. Hãy bật GPS, ra nơi thoáng rồi thử lại.'),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  });
}

export type AppealType = 'WRONG_INFO' | 'NO_CHECKIN' | 'PROXY_CHECKIN' | 'DUPLICATE_MSSV';

export interface MyAppeal {
  id: string;
  type: AppealType;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED';
  deadlineAt: string;
  createdAt: string;
  resolutionNote: string | null;
  eventTitle?: string;
}

export interface AppealInput {
  token: string;
  idempotencyKey: string;
  type: AppealType;
  content: string;
  mssv?: string;
  fullName?: string;
  facultyUnitId?: string;
}

export const sendAppeal = (input: AppealInput) => call<MyAppeal>('POST', '/appeals', input);
export const myAppeals = () => call<{ items: MyAppeal[] }>('GET', '/me/appeals');

// ---------- tra cuu lich su (P06) ----------

export interface HistoryItem {
  eventTitle: string;
  eventStartAt: string;
  checkinAt: string;
  checkoutAt: string | null;
  timeliness: 'ON_TIME' | 'LATE';
  // false = luot do thiet bi KHAC diem danh cho MSSV dang gan voi may nay (dau hieu bi diem danh ho)
  viaThisDevice: boolean;
  confirmCode: string | null;
}

export const myHistory = () => call<{ items: HistoryItem[]; proxyWarning?: boolean; duesWarning?: string | null }>('GET', '/me/history');
