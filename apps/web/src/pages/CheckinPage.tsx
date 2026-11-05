// Trang diem danh cong khai cho sinh vien (mobile-first) - dac ta 3.3, chot-giao-dien.md muc 1
// Luong: quet QR -> form -> xac nhan -> (xin GPS neu su kien co toa do) -> ve. Diem danh ra: nut + ma 4 so neu muc Chat.
import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { DuesAlert, fmt, ProxyAlert } from '../format';
import {
  AppealType, checkin, checkout, editTicket, Faculty, getPosition, loadFaculties, loadToken, myAppeals, MyAppeal, Position, PublicError,
  sendAppeal, Ticket, TokenInfo, uuid4,
} from '../publicApi';

const STATE_TEXT: Record<Exclude<TokenInfo['state'], 'OPEN'>, (i: TokenInfo) => string> = {
  NOT_YET: (i) => `Điểm danh sẽ mở lúc ${fmt(i.event.checkinOpenAt)}.`,
  CLOSED: () => 'Sự kiện đã đóng điểm danh.',
  NOT_AVAILABLE: () => 'Sự kiện hiện không nhận điểm danh.',
};

export function CheckinPage() {
  const { token = '' } = useParams();
  const [info, setInfo] = useState<TokenInfo | null>(null);
  const [faculties, setFaculties] = useState<Faculty[]>([]);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [fatal, setFatal] = useState('');

  useEffect(() => {
    loadToken(token)
      .then((i) => {
        setInfo(i);
        setTicket(i.attendance);
      })
      .catch((e: PublicError) => setFatal(e.message));
    loadFaculties().then(setFaculties).catch(() => {});
  }, [token]);

  return (
    <div className="pub">
      <header className="pub-head">
        <div className="pub-logos">
          <img src="/brand/logo-doan.png" alt="Đoàn TNCS Hồ Chí Minh" />
          <img src="/brand/logo-hoi.png" alt="Hội Sinh viên Việt Nam" />
        </div>
        <div>Đoàn Thanh niên · Hội Sinh viên</div>
        <b>Điểm danh sự kiện</b>
      </header>
      <main className="pub-body">
        {fatal && <div className="error" role="alert">{fatal}</div>}
        {!fatal && !info && <p>Đang tải…</p>}
        {info && (
          <>
            {info.proxyWarning && <ProxyAlert />}
            {info.duesWarning && <DuesAlert message={info.duesWarning} />}
            <EventCard info={info} />
            {info.purpose === 'CHECKIN' ? (
              <CheckinFlow token={token} info={info} faculties={faculties} ticket={ticket} setTicket={setTicket} />
            ) : (
              <CheckoutFlow token={token} info={info} ticket={ticket} setTicket={setTicket} />
            )}
            {info.appeal.open && <AppealSection token={token} info={info} faculties={faculties} ticket={ticket} />}
          </>
        )}
      </main>
    </div>
  );
}

function EventCard({ info }: { info: TokenInfo }) {
  const e = info.event;
  return (
    <section className="pub-card">
      <span className="badge info">{info.purpose === 'CHECKIN' ? 'Điểm danh vào' : 'Điểm danh ra'}</span>
      <h1 style={{ fontSize: 22, margin: '8px 0 4px' }}>{e.title}</h1>
      <p className="sub" style={{ margin: 0 }}>{fmt(e.startAt)} – {fmt(e.endAt)}</p>
      {e.locationName && <p className="sub" style={{ margin: 0 }}>{e.locationName}</p>}
      {info.state !== 'OPEN' && <div className="notice" style={{ marginTop: 12 }}>{STATE_TEXT[info.state](info)}</div>}
    </section>
  );
}

// ---------- diem danh vao ----------

function CheckinFlow(p: { token: string; info: TokenInfo; faculties: Faculty[]; ticket: Ticket | null; setTicket: (t: Ticket) => void }) {
  const { info, ticket } = p;
  const pre = info.prefill;
  const [f, setF] = useState({ mssv: pre?.mssv ?? '', fullName: pre?.fullName ?? '', facultyUnitId: pre?.facultyUnitId ?? '', email: pre?.email ?? '' });
  const [step, setStep] = useState<'form' | 'confirm'>('form');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // cung mot khoa cho moi lan gui lai (mat mang): server tra ket qua cu thay vi tao luot moi
  const key = useRef(uuid4());

  if (ticket) return <TicketView ticket={ticket} info={info} faculties={p.faculties} setTicket={p.setTicket} />;
  if (info.state !== 'OPEN') return null;

  const facultyName = p.faculties.find((x) => x.id === f.facultyUnitId)?.name ?? '';
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  function toConfirm(e: FormEvent) {
    e.preventDefault();
    const mssv = f.mssv.trim().toUpperCase();
    try {
      if (!new RegExp(info.mssvRegex, 'i').test(mssv)) return setError('MSSV không đúng định dạng, ví dụ 24211TM1152.');
    } catch { /* bieu thuc cau hinh loi: de server kiem tra */ }
    setError('');
    setStep('confirm');
  }

  async function submit() {
    setBusy(true);
    setError('');
    try {
      const pos: Partial<Position> = info.event.requiresGps ? await getPosition() : {};
      const res = await checkin({
        token: p.token, idempotencyKey: key.current, mssv: f.mssv.trim().toUpperCase(), fullName: f.fullName,
        facultyUnitId: f.facultyUnitId, ...(f.email.trim() ? { email: f.email.trim() } : {}), ...pos,
      });
      p.setTicket(res.attendance);
    } catch (err) {
      const e = err as PublicError;
      // thiet bi nay da diem danh roi: hien ve cu
      if (e.body?.attendance) return p.setTicket(e.body.attendance);
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (step === 'confirm') {
    return (
      <section className="pub-card">
        <h2>Xác nhận thông tin</h2>
        <p style={{ fontSize: 18, margin: '0 0 16px' }}>
          Bạn là <b>{f.fullName}</b>, MSSV <b className="mono">{f.mssv.trim().toUpperCase()}</b>, {facultyName}?
        </p>
        {info.event.requiresGps && <div className="notice">Sự kiện yêu cầu vị trí. Khi bấm Xác nhận, trình duyệt sẽ hỏi quyền truy cập vị trí; hãy chọn Cho phép.</div>}
        {error && <div className="error" role="alert">{error}</div>}
        <button className="btn primary pub-btn" disabled={busy} onClick={submit}>
          {busy ? 'Đang gửi…' : error ? 'Thử lại' : 'Xác nhận điểm danh'}
        </button>
        <button className="btn pub-btn" style={{ marginTop: 10 }} disabled={busy} onClick={() => setStep('form')}>Sửa thông tin</button>
      </section>
    );
  }

  return (
    <form className="pub-card" onSubmit={toConfirm}>
      <h2>Thông tin điểm danh</h2>
      {error && <div className="error" role="alert">{error}</div>}
      <label className="field">
        <span>Mã số sinh viên</span>
        <input className="mono" required maxLength={20} autoCapitalize="characters" autoComplete="off" value={f.mssv} onChange={(e) => set('mssv', e.target.value)} />
      </label>
      <label className="field">
        <span>Họ và tên</span>
        <input required minLength={2} maxLength={100} autoComplete="name" value={f.fullName} onChange={(e) => set('fullName', e.target.value)} />
      </label>
      <label className="field">
        <span>Khoa</span>
        <select required value={f.facultyUnitId} onChange={(e) => set('facultyUnitId', e.target.value)}>
          <option value="">Chọn khoa</option>
          {p.faculties.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </label>
      <label className="field">
        <span>Email (không bắt buộc)</span>
        <input type="email" maxLength={150} autoComplete="email" value={f.email} onChange={(e) => set('email', e.target.value)} />
      </label>
      <button className="btn primary pub-btn">Tiếp tục</button>
      <p className="sub" style={{ margin: '14px 0 0', fontSize: 13 }}>
        Thông tin (MSSV, họ tên, khoa{info.event.requiresGps ? ', vị trí' : ''}, thiết bị) dùng để xác nhận tham gia và cộng điểm rèn luyện.
      </p>
    </form>
  );
}

// ---------- ve diem danh + sua thong tin ----------

function TicketView(p: { ticket: Ticket; info: TokenInfo; faculties: Faculty[]; setTicket: (t: Ticket) => void }) {
  const t = p.ticket;
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({ mssv: t.mssv, fullName: t.fullName, facultyUnitId: t.facultyUnitId, email: t.email ?? '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const facultyName = p.faculties.find((x) => x.id === t.facultyUnitId)?.name ?? '';
  const canEdit = t.canEdit && p.info.state === 'OPEN';

  async function save(e: FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = { idempotencyKey: uuid4() };
    const mssv = f.mssv.trim().toUpperCase();
    if (mssv !== t.mssv) body.mssv = mssv;
    if (f.fullName !== t.fullName) body.fullName = f.fullName;
    if (f.facultyUnitId !== t.facultyUnitId) body.facultyUnitId = f.facultyUnitId;
    if (f.email.trim() !== (t.email ?? '')) body.email = f.email.trim() || null;
    setBusy(true);
    setError('');
    try {
      p.setTicket((await editTicket(t.id, body)).attendance);
      setEditing(false);
    } catch (err) {
      setError((err as PublicError).message);
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <form className="pub-card" onSubmit={save}>
        <h2>Sửa thông tin</h2>
        <p className="sub">Còn {t.editsLeft} lần sửa. Mọi thay đổi đều được ghi lại.</p>
        {error && <div className="error" role="alert">{error}</div>}
        <label className="field"><span>Mã số sinh viên</span>
          <input className="mono" required maxLength={20} value={f.mssv} onChange={(e) => setF({ ...f, mssv: e.target.value })} /></label>
        <label className="field"><span>Họ và tên</span>
          <input required minLength={2} maxLength={100} value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></label>
        <label className="field"><span>Khoa</span>
          <select required value={f.facultyUnitId} onChange={(e) => setF({ ...f, facultyUnitId: e.target.value })}>
            {p.faculties.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select></label>
        <label className="field"><span>Email</span>
          <input type="email" maxLength={150} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
        <button className="btn primary pub-btn" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu thay đổi'}</button>
        <button type="button" className="btn pub-btn" style={{ marginTop: 10 }} onClick={() => setEditing(false)}>Hủy</button>
      </form>
    );
  }

  return (
    <section className="pub-card ticket">
      <span className="badge ok">Đã điểm danh</span>
      <h2 style={{ marginTop: 10 }}>{t.fullName}</h2>
      <p className="sub" style={{ margin: 0 }}><span className="mono">{t.mssv}</span> · {facultyName}</p>
      <p style={{ margin: '14px 0 4px' }}>
        {fmt(t.checkinAt)} · {t.timeliness === 'ON_TIME' ? <span className="badge ok">Đúng giờ</span> : <span className="badge wait">Trễ giờ</span>}
      </p>
      {t.checkoutAt && <p className="sub" style={{ margin: 0 }}>Đã điểm danh ra lúc {fmt(t.checkoutAt)}</p>}
      <div className="ticket-code">
        <span>Mã xác nhận</span>
        <b className="mono">{t.confirmCode}</b>
      </div>
      {p.info.event.requireCheckout && !t.checkoutAt && (
        <div className="notice">Sự kiện này yêu cầu điểm danh ra. Cuối buổi hãy quét mã QR điểm danh ra.</div>
      )}
      {canEdit && <button className="btn pub-btn" onClick={() => setEditing(true)}>Sửa thông tin ({t.editsLeft} lần)</button>}
      <p style={{ margin: '14px 0 0', textAlign: 'center' }}><Link to="/tra-cuu">Xem lịch sử điểm danh trên máy này</Link></p>
    </section>
  );
}

// ---------- diem danh ra ----------

function CheckoutFlow(p: { token: string; info: TokenInfo; ticket: Ticket | null; setTicket: (t: Ticket) => void }) {
  const { info, ticket } = p;
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const key = useRef(uuid4());

  if (!ticket) {
    return <section className="pub-card"><div className="notice" style={{ margin: 0 }}>Bạn chưa điểm danh vào sự kiện này bằng thiết bị này. Hãy dùng đúng điện thoại đã điểm danh vào.</div></section>;
  }
  if (ticket.checkoutAt) {
    return <section className="pub-card"><span className="badge ok">Đã điểm danh ra</span><p style={{ marginBottom: 0 }}>{ticket.fullName} · {fmt(ticket.checkoutAt)}</p></section>;
  }
  if (info.state !== 'OPEN') return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const pos: Partial<Position> = info.event.requiresGps ? await getPosition() : {};
      const res = await checkout({ token: p.token, idempotencyKey: key.current, ...(info.verifyCodeRequired ? { verifyCode: code } : {}), ...pos });
      p.setTicket(res.attendance);
    } catch (err) {
      const e2 = err as PublicError;
      if (e2.code === 'ALREADY_CHECKED_OUT' && e2.body?.attendance) return p.setTicket(e2.body.attendance);
      // ma 4 so sai: server tra attemptsLeft
      const left = e2.body?.attemptsLeft;
      setError(left === undefined ? e2.message : `${e2.message} Còn ${left} lần thử.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="pub-card" onSubmit={submit}>
      <h2>Điểm danh ra</h2>
      <p className="sub">Xin chào {ticket.fullName} ({ticket.mssv}).</p>
      {error && <div className="error" role="alert">{error}</div>}
      {info.verifyCodeRequired && (
        <label className="field">
          <span>Mã 4 số do ban tổ chức đọc tại chỗ</span>
          <input className="mono" required inputMode="numeric" pattern="\d{4}" maxLength={4} autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
        </label>
      )}
      {info.event.requiresGps && <div className="notice">Sự kiện yêu cầu vị trí; hãy chọn Cho phép khi trình duyệt hỏi.</div>}
      <button className="btn primary pub-btn" disabled={busy}>{busy ? 'Đang gửi…' : 'Điểm danh ra'}</button>
    </form>
  );
}

// ---------- khieu nai (dac ta 3.5) ----------

const APPEAL_TYPES: Array<[AppealType, string]> = [
  ['WRONG_INFO', 'Sai thông tin'],
  ['NO_CHECKIN', 'Tôi có tham gia nhưng không điểm danh được'],
  ['PROXY_CHECKIN', 'Tôi bị điểm danh hộ'],
  ['DUPLICATE_MSSV', 'Trùng MSSV'],
];
const APPEAL_STATUS: Record<MyAppeal['status'], [string, string]> = { PENDING: ['Chờ xử lý', 'wait'], ACCEPTED: ['Đã chấp nhận', 'ok'], REJECTED: ['Bị từ chối', 'err'] };

function AppealSection({ token, info, faculties, ticket }: { token: string; info: TokenInfo; faculties: Faculty[]; ticket: Ticket | null }) {
  const [open, setOpen] = useState(false);
  const [mine, setMine] = useState<MyAppeal[]>([]);
  const [f, setF] = useState({ type: (ticket ? 'WRONG_INFO' : 'NO_CHECKIN') as AppealType, content: '', mssv: '', fullName: '', facultyUnitId: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const key = useRef(uuid4());
  const loadMine = () => myAppeals().then((r) => setMine(r.items)).catch(() => {});
  useEffect(() => { loadMine(); }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await sendAppeal({
        token, idempotencyKey: key.current, type: f.type, content: f.content,
        // chua co luot tren thiet bi nay thi phai khai danh tinh
        ...(ticket ? {} : { mssv: f.mssv.trim().toUpperCase(), fullName: f.fullName, facultyUnitId: f.facultyUnitId }),
      });
      key.current = uuid4();
      setOpen(false);
      setF({ ...f, content: '' });
      await loadMine();
    } catch (err) {
      setError((err as PublicError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="pub-card">
      <h2>Khiếu nại</h2>
      <p className="sub">Có sai sót hoặc không điểm danh được? Gửi khiếu nại trước {fmt(info.appeal.deadlineAt)}.</p>
      {mine.map((a) => (
        <div key={a.id} className="notice" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
          <span className={`badge ${APPEAL_STATUS[a.status][1]}`}>{APPEAL_STATUS[a.status][0]}</span>{' '}
          {APPEAL_TYPES.find(([t]) => t === a.type)?.[1]}{a.eventTitle ? ` · ${a.eventTitle}` : ''}
          {a.resolutionNote && <><br />Phản hồi: {a.resolutionNote}</>}
        </div>
      ))}
      {!open && <button className="btn pub-btn" onClick={() => setOpen(true)}>Gửi khiếu nại</button>}
      {open && (
        <form onSubmit={submit}>
          {error && <div className="error" role="alert">{error}</div>}
          <label className="field"><span>Loại khiếu nại</span>
            <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as AppealType })}>
              {APPEAL_TYPES.map(([t, label]) => <option key={t} value={t}>{label}</option>)}
            </select></label>
          {!ticket && (
            <>
              <label className="field"><span>Mã số sinh viên</span><input className="mono" required maxLength={20} value={f.mssv} onChange={(e) => setF({ ...f, mssv: e.target.value })} /></label>
              <label className="field"><span>Họ và tên</span><input required minLength={2} maxLength={100} value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></label>
              <label className="field"><span>Khoa</span>
                <select required value={f.facultyUnitId} onChange={(e) => setF({ ...f, facultyUnitId: e.target.value })}>
                  <option value="">Chọn khoa</option>{faculties.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select></label>
            </>
          )}
          <label className="field"><span>Nội dung (10–1000 ký tự)</span>
            <textarea rows={4} required minLength={10} maxLength={1000} value={f.content} onChange={(e) => setF({ ...f, content: e.target.value })} /></label>
          <button className="btn primary pub-btn" disabled={busy}>{busy ? 'Đang gửi…' : 'Gửi khiếu nại'}</button>
          <button type="button" className="btn pub-btn" style={{ marginTop: 10 }} onClick={() => setOpen(false)}>Hủy</button>
        </form>
      )}
    </section>
  );
}
