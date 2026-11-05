// Khung quan tri: menu trai xanh Doan, thanh tren; chua dang nhap thi ve /dang-nhap.
import { useEffect, useState } from 'react';
import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom';
import { api, Reminders, Unit } from '../api';
import { useAuth } from '../auth';
import { LogoTrio } from '../components/Brand';
import { UserMenu } from '../components/UserMenu';

// Man chi Doan truong: API da chan 403, day chi de khong hien man trong (dac ta 8.2)
export function RequireAdmin() {
  const { user } = useAuth();
  return user?.role === 'SCHOOL_ADMIN' ? <Outlet /> : <div className="error">Chỉ quản trị Đoàn trường mới dùng được mục này.</div>;
}

// Man khong co khung quan tri (vd. trinh chieu toan man hinh) nhung van bat buoc dang nhap
export function RequireAuth() {
  const { user, loading } = useAuth();
  if (loading) return <div className="content">Đang tải…</div>;
  if (!user) return <Navigate to="/dang-nhap" replace />;
  if (user.mustChangePassword) return <Navigate to="/doi-mat-khau" replace />;
  return <Outlet />;
}

export function Layout() {
  const { user, loading, signOut } = useAuth();
  const { pathname } = useLocation();
  const [due, setDue] = useState(0);
  const [unread, setUnread] = useState(0);
  const [unitName, setUnitName] = useState<string | null>(null);

  // so nhac viec canh muc Tong quan; cap nhat moi lan doi man
  useEffect(() => {
    if (!user || user.mustChangePassword) return;
    api<Reminders>('GET', '/admin/dashboard/reminders').then((r) => setDue(r.pendingReview.length + r.appealsDue.length)).catch(() => {});
  }, [user, pathname]);

  // so thong bao chua doc: lay lai khi doi man hoac khi trang Thong bao danh dau da doc
  useEffect(() => {
    if (!user || user.mustChangePassword) return;
    const refresh = () => api<{ unread: number }>('GET', '/admin/notifications/unread-count').then((r) => setUnread(r.unread)).catch(() => {});
    refresh();
    window.addEventListener('notifications-changed', refresh);
    return () => window.removeEventListener('notifications-changed', refresh);
  }, [user, pathname]);

  // ten don vi cho menu tai khoan (API tra 404 neu ngoai pham vi, nhung day la don vi cua chinh minh)
  const unitId = user && !user.mustChangePassword ? user.unitId : null;
  useEffect(() => {
    setUnitName(null);
    if (!unitId) return;
    api<Unit>('GET', `/admin/units/${unitId}`).then((u) => setUnitName(u.name)).catch(() => {});
  }, [unitId]);

  if (loading) return <div className="content">Đang tải…</div>;
  if (!user) return <Navigate to="/dang-nhap" replace />;
  // [BM] TK moi tao bat buoc doi mat khau truoc khi dung cac man khac (API cung chan)
  if (user.mustChangePassword && pathname !== '/doi-mat-khau') return <Navigate to="/doi-mat-khau" replace />;

  return (
    <div className="shell">
      <nav className="side">
        <div className="brand"><LogoTrio size={30} /><span>Đoàn - Hội TDC</span></div>
        <NavLink to="/tong-quan">Tổng quan{due > 0 && <span className="nav-badge" title="Việc cần xử lý">{due}</span>}</NavLink>
        <div className="group">Hoạt động</div>
        <NavLink to="/hoat-dong" end>Hồ sơ hoạt động</NavLink>
        <NavLink to="/hoat-dong/lich">Lịch hoạt động</NavLink>
        <NavLink to="/hoat-dong/thong-ke">Thống kê hoạt động</NavLink>
        <div className="group">Điểm danh</div>
        <NavLink to="/su-kien">Sự kiện</NavLink>
        <NavLink to="/khieu-nai">Khiếu nại</NavLink>
        <div className="group">Sinh viên</div>
        <NavLink to="/sinh-vien">Hồ sơ sinh viên</NavLink>
        <NavLink to="/bao-cao">Báo cáo ĐRL</NavLink>
        {user.role === 'SCHOOL_ADMIN' && (
          <>
            <div className="group">Hệ thống</div>
            <NavLink to="/tai-khoan">Tài khoản quản trị</NavLink>
            <NavLink to="/don-vi">Đơn vị</NavLink>
            <NavLink to="/nam-hoc">Năm học và lĩnh vực</NavLink>
            <NavLink to="/cau-hinh">Cấu hình</NavLink>
            <NavLink to="/phi-doan-hoi">Chưa đóng phí</NavLink>
            <NavLink to="/nhat-ky">Nhật ký</NavLink>
          </>
        )}
        <div className="group">Tài khoản</div>
        <NavLink to="/doi-mat-khau">Đổi mật khẩu</NavLink>
      </nav>
      <div className="main">
        <header className="top">
          <NavLink to="/thong-bao" className="bell" aria-label={unread > 0 ? `Thông báo, ${unread} chưa đọc` : 'Thông báo'}>
            🔔{unread > 0 && <span className="nav-badge">{unread > 99 ? '99+' : unread}</span>}
          </NavLink>
          <UserMenu user={user} unitName={unitName} onSignOut={signOut} />
        </header>
        <main className="content wide">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
