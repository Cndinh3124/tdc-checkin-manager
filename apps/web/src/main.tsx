import '@fontsource/open-sans/400.css';
import '@fontsource/open-sans/600.css';
import '@fontsource/open-sans/700.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';
import '@fontsource/jetbrains-mono/400.css';
import './styles.css';
import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth';
import { CheckinPage } from './pages/CheckinPage';

// [NV] 11: trang diem danh cong khai tai nhe - ma quan tri tach rieng, chi tai khi vao khu quan tri
const Layout = lazy(() => import('./pages/Layout').then((m) => ({ default: m.Layout })));
const Lookup = lazy(() => import('./pages/Lookup').then((m) => ({ default: m.Lookup })));
const RequireAuth = lazy(() => import('./pages/Layout').then((m) => ({ default: m.RequireAuth })));
const Present = lazy(() => import('./pages/Present').then((m) => ({ default: m.Present })));
const RequireAdmin = lazy(() => import('./pages/Layout').then((m) => ({ default: m.RequireAdmin })));
const Activities = lazy(() => import('./pages/Activities').then((m) => ({ default: m.Activities })));
const ActivityStats = lazy(() => import('./pages/ActivityStats').then((m) => ({ default: m.ActivityStats })));
const ActivityCalendar = lazy(() => import('./pages/ActivityCalendar').then((m) => ({ default: m.ActivityCalendar })));
const ActivityConfig = lazy(() => import('./pages/ActivityConfig').then((m) => ({ default: m.ActivityConfig })));
const ActivityDetail = lazy(() => import('./pages/ActivityDetail').then((m) => ({ default: m.ActivityDetail })));
const ActivityForm = lazy(() => import('./pages/ActivityForm').then((m) => ({ default: m.ActivityForm })));
const Notifications = lazy(() => import('./pages/Notifications').then((m) => ({ default: m.Notifications })));
const Appeals = lazy(() => import('./pages/Appeals').then((m) => ({ default: m.Appeals })));
const AuditLog = lazy(() => import('./pages/AuditLog').then((m) => ({ default: m.AuditLog })));
const ChangePassword = lazy(() => import('./pages/ChangePassword').then((m) => ({ default: m.ChangePassword })));
const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const EventDetail = lazy(() => import('./pages/EventDetail').then((m) => ({ default: m.EventDetail })));
const EventForm = lazy(() => import('./pages/EventForm').then((m) => ({ default: m.EventForm })));
const Events = lazy(() => import('./pages/Events').then((m) => ({ default: m.Events })));
const Login = lazy(() => import('./pages/Login').then((m) => ({ default: m.Login })));
const Reports = lazy(() => import('./pages/Reports').then((m) => ({ default: m.Reports })));
const Review = lazy(() => import('./pages/Review').then((m) => ({ default: m.Review })));
const Settings = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })));
const DuesUnpaid = lazy(() => import('./pages/DuesUnpaid').then((m) => ({ default: m.DuesUnpaid })));
const Students = lazy(() => import('./pages/Students').then((m) => ({ default: m.Students })));
const Units = lazy(() => import('./pages/Units').then((m) => ({ default: m.Units })));
const Users = lazy(() => import('./pages/Users').then((m) => ({ default: m.Users })));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Suspense fallback={<div className="content">Đang tải…</div>}>
        <Routes>
          <Route path="/dang-nhap" element={<Login />} />
          <Route path="/diem-danh/:token" element={<CheckinPage />} />
          <Route path="/tra-cuu" element={<Lookup />} />
          <Route element={<RequireAuth />}>
            <Route path="/trinh-chieu/:id" element={<Present />} />
          </Route>
          <Route element={<Layout />}>
            <Route path="/doi-mat-khau" element={<ChangePassword />} />
            <Route path="/tong-quan" element={<Dashboard />} />
            <Route path="/su-kien" element={<Events />} />
            <Route path="/su-kien/moi" element={<EventForm />} />
            <Route path="/su-kien/:id" element={<EventDetail />} />
            <Route path="/su-kien/:id/sua" element={<EventForm />} />
            <Route path="/su-kien/:id/duyet" element={<Review />} />
            <Route path="/hoat-dong" element={<Activities />} />
            <Route path="/hoat-dong/thong-ke" element={<ActivityStats />} />
            <Route path="/hoat-dong/lich" element={<ActivityCalendar />} />
            <Route path="/hoat-dong/moi" element={<ActivityForm />} />
            <Route path="/hoat-dong/:id" element={<ActivityDetail />} />
            <Route path="/hoat-dong/:id/sua" element={<ActivityForm />} />
            <Route path="/thong-bao" element={<Notifications />} />
            <Route path="/khieu-nai" element={<Appeals />} />
            <Route path="/sinh-vien" element={<Students />} />
            <Route path="/bao-cao" element={<Reports />} />
            <Route element={<RequireAdmin />}>
              <Route path="/tai-khoan" element={<Users />} />
              <Route path="/don-vi" element={<Units />} />
              <Route path="/cau-hinh" element={<Settings />} />
              <Route path="/phi-doan-hoi" element={<DuesUnpaid />} />
              <Route path="/nam-hoc" element={<ActivityConfig />} />
              <Route path="/nhat-ky" element={<AuditLog />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/tong-quan" replace />} />
        </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
