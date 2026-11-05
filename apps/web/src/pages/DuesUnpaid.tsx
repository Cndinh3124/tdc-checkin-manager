// Danh sach chua dong doan phi - hoi phi (chi Doan truong): soan loi canh bao + tai danh sach MSSV.
// Chi gan co va hien canh bao cho sinh vien; khong tu dong tru diem ren luyen, nguoi duyet tu quyet dinh.
import { ChangeEvent, FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { DuesAlert } from '../format';

const MAX_MESSAGE = 500;
// tach theo khoang trang, dau phay, cham phay (dan tu cot Excel hoac mo file .csv / .txt)
const parse = (text: string) => [...new Set(text.split(/[\s,;]+/).map((s) => s.trim().toUpperCase()).filter(Boolean))];

export function DuesUnpaid() {
  const [message, setMessage] = useState('');
  const [savedMessage, setSavedMessage] = useState('');
  const [list, setList] = useState('');
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([api<Record<string, unknown>>('GET', '/admin/settings'), api<{ total: number; mssvs: string[] }>('GET', '/admin/dues-unpaid')])
      .then(([s, d]) => {
        const m = String(s.dues_warning_message ?? '');
        setMessage(m);
        setSavedMessage(m);
        setList(d.mssvs.join('\n'));
        setTotal(d.total);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Không tải được dữ liệu.'));
  }, []);

  async function pickFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) setList(await file.text());
    e.target.value = '';
  }

  async function saveMessage(e: FormEvent) {
    e.preventDefault();
    run(async () => {
      const s = await api<Record<string, unknown>>('PATCH', '/admin/settings', { dues_warning_message: message });
      setSavedMessage(String(s.dues_warning_message));
      setMessage(String(s.dues_warning_message));
      setOk('Đã lưu nội dung cảnh báo.');
    });
  }

  async function saveList(e: FormEvent) {
    e.preventDefault();
    const mssvs = parse(list);
    if (!window.confirm(`Thay toàn bộ danh sách hiện tại bằng ${mssvs.length} MSSV?`)) return;
    run(async () => {
      const r = await api<{ total: number; flagged: number }>('PUT', '/admin/dues-unpaid', { mssvs });
      setTotal(r.total);
      setList(mssvs.join('\n'));
      setOk(`Đã lưu ${r.total} MSSV; gắn cờ thêm cho ${r.flagged} lượt điểm danh đã có.`);
    });
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    setOk('');
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không lưu được.');
    } finally {
      setBusy(false);
    }
  }

  const count = parse(list).length;

  return (
    <>
      <h1>Chưa đóng đoàn phí - hội phí</h1>
      <p className="sub">
        Sinh viên trong danh sách vẫn được ghi nhận lượt điểm danh (lưu vết), nhưng sẽ thấy cảnh báo đỏ và lượt đó bị gắn cờ cho người duyệt.
        Hệ thống không tự trừ hay tự khóa điểm rèn luyện.
      </p>
      {error && <div className="error" role="alert">{error}</div>}
      {ok && <div className="notice" role="status">{ok}</div>}
      {total === null && !error && <p>Đang tải…</p>}
      {total !== null && (
        <>
          <form className="card" onSubmit={saveMessage} style={{ maxWidth: 640 }}>
            <label className="field">
              <span>Nội dung cảnh báo hiển thị cho sinh viên</span>
              <textarea rows={4} required maxLength={MAX_MESSAGE} value={message} onChange={(e) => { setMessage(e.target.value); setOk(''); }} />
              <span style={{ fontSize: 13, color: 'var(--faint)', marginTop: 4 }}>{message.length}/{MAX_MESSAGE} ký tự. Xem trước bên dưới.</span>
            </label>
            {message.trim() && <DuesAlert message={message.trim()} />}
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn primary" disabled={busy || !message.trim() || message === savedMessage}>Lưu nội dung</button>
            </div>
          </form>
          <form className="card" onSubmit={saveList} style={{ maxWidth: 640, marginTop: 16 }}>
            <label className="field">
              <span>Danh sách MSSV chưa đóng phí (hiện có {total})</span>
              <textarea rows={10} className="mono" value={list} onChange={(e) => { setList(e.target.value); setOk(''); }} placeholder="Mỗi MSSV một dòng, hoặc ngăn cách bằng dấu phẩy" />
              <span style={{ fontSize: 13, color: 'var(--faint)', marginTop: 4 }}>
                Tải lên sẽ thay thế toàn bộ danh sách. Cờ đã gắn cho lượt điểm danh trước đó không tự gỡ khi bỏ MSSV khỏi danh sách.
              </span>
            </label>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <label className="btn">
                Chọn file .csv / .txt
                <input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={pickFile} hidden />
              </label>
              <button className="btn primary" disabled={busy}>{busy ? 'Đang lưu…' : `Lưu danh sách (${count} MSSV)`}</button>
            </div>
          </form>
        </>
      )}
    </>
  );
}
