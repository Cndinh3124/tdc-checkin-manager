// Tra cuu lich su diem danh tren may nay (P06) - dac ta 5.4: nguoi bi diem danh ho tu phat hien.
// Chi hien ten su kien + gio; ma xac nhan chi cho luot do chinh may nay diem danh.
import { useEffect, useState } from 'react';
import { HistoryItem, myAppeals, MyAppeal, myHistory, PublicError } from '../publicApi';
import { DuesAlert, fmt, ProxyAlert } from '../format';

const APPEAL_STATUS: Record<MyAppeal['status'], [string, string]> = {
  PENDING: ['Đang chờ xử lý', 'wait'],
  ACCEPTED: ['Đã chấp nhận', 'ok'],
  REJECTED: ['Bị từ chối', 'err'],
};

export function Lookup() {
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [appeals, setAppeals] = useState<MyAppeal[]>([]);
  const [proxyWarning, setProxyWarning] = useState(false);
  const [duesWarning, setDuesWarning] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    myHistory().then((r) => { setItems(r.items); setProxyWarning(!!r.proxyWarning); setDuesWarning(r.duesWarning ?? null); }).catch((e: PublicError) => setError(e.message));
    myAppeals().then((r) => setAppeals(r.items)).catch(() => {});
  }, []);

  const proxied = items?.filter((i) => !i.viaThisDevice) ?? [];

  return (
    <div className="pub">
      <header className="pub-head">
        <div className="pub-logos">
          <img src="/brand/logo-doan.png" alt="Đoàn TNCS Hồ Chí Minh" />
          <img src="/brand/logo-hoi.png" alt="Hội Sinh viên Việt Nam" />
        </div>
        <div>Đoàn Thanh niên · Hội Sinh viên</div>
        <b>Lịch sử điểm danh</b>
      </header>
      <main className="pub-body">
        {proxyWarning && <ProxyAlert />}
        {duesWarning && <DuesAlert message={duesWarning} />}
        {error && <div className="error" role="alert">{error}</div>}
        {!error && !items && <p>Đang tải…</p>}
        {items && items.length === 0 && (
          <section className="pub-card">
            <p style={{ margin: 0 }}>Điện thoại này chưa điểm danh sự kiện nào. Hãy quét mã QR tại sự kiện để bắt đầu.</p>
          </section>
        )}
        {proxied.length > 0 && (
          <div className="notice" role="status">
            Có {proxied.length} lượt điểm danh cho MSSV của bạn do thiết bị khác ghi nhận. Nếu không phải bạn, hãy quét lại mã QR của sự kiện đó và gửi khiếu nại “Bị điểm danh hộ” ở cuối trang.
          </div>
        )}
        {items && items.length > 0 && (
          <section className="pub-card">
            <h2>Các lượt điểm danh</h2>
            <ul className="history">
              {items.map((i, n) => (
                <li key={n}>
                  <b>{i.eventTitle}</b>
                  <span className="sub" style={{ margin: 0 }}>
                    {fmt(i.checkinAt)} · {i.timeliness === 'ON_TIME' ? 'Đúng giờ' : 'Trễ giờ'}
                    {i.checkoutAt && ` · ra lúc ${fmt(i.checkoutAt)}`}
                  </span>
                  {i.viaThisDevice ? (
                    i.confirmCode && <span className="mono">Mã xác nhận: {i.confirmCode}</span>
                  ) : (
                    <span className="badge wait">Do thiết bị khác điểm danh</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        {appeals.length > 0 && (
          <section className="pub-card">
            <h2>Khiếu nại của bạn</h2>
            <ul className="history">
              {appeals.map((a) => {
                const [label, tone] = APPEAL_STATUS[a.status];
                return (
                  <li key={a.id}>
                    <b>{a.eventTitle ?? 'Sự kiện'}</b>
                    <span><span className={`badge ${tone}`}>{label}</span></span>
                    {a.resolutionNote && <span className="sub" style={{ margin: 0 }}>Phản hồi: {a.resolutionNote}</span>}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
