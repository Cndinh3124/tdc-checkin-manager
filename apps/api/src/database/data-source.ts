// Data source dung chung cho app, CLI migration va test
import { DataSource, DataSourceOptions } from 'typeorm';
import { AppEnv, loadEnv } from '../config/env';
import { Unit } from '../units/entities/unit.entity';
import { AdminUser } from '../users/entities/admin-user.entity';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { SystemSetting } from '../settings/entities/system-setting.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { Appeal } from '../appeals/appeal.entity';
import { Event } from '../events/entities/event.entity';
import { EventQrToken } from '../events/entities/event-qr-token.entity';
import { EventFacultyView } from '../events/entities/event-faculty-view.entity';
import { Device } from '../public/entities/device.entity';
import { Student } from '../public/entities/student.entity';
import { StudentDevice } from '../public/entities/student-device.entity';
import { Attendance } from '../public/entities/attendance.entity';
import { AttendanceFlag } from '../public/entities/attendance-flag.entity';
import { AttendanceEdit } from '../public/entities/attendance-edit.entity';
import { AttendanceJob } from '../public/entities/attendance-job.entity';
import { EventCounter } from '../public/entities/event-counter.entity';
import { EventCodeFailure } from '../public/entities/event-code-failure.entity';
import { AcademicYear } from '../activities/entities/academic-year.entity';
import { ActivityCategory } from '../activities/entities/activity-category.entity';
import { ActivityCodeSequence } from '../activities/entities/activity-code-sequence.entity';
import { Activity } from '../activities/entities/activity.entity';
import {
  ActivityCoUnit, ActivityEvent, ActivityLink, ActivityVersion, Comment, Notification, WorkflowAction,
} from '../activities/entities/activity-parts.entity';
import { AddActivities1793800000000 } from './migrations/1793800000000-add-activities';
import { InitSchema1793495899423 } from './migrations/1793495899423-init-schema';
import { AddEvents1793500640024 } from './migrations/1793500640024-add-events';
import { AddEventFacultyView1793501916085 } from './migrations/1793501916085-add-event-faculty-view';
import { EventFacultyViewMode1793502499621 } from './migrations/1793502499621-event-faculty-view-mode';
import { AddAttendance1793600000000 } from './migrations/1793600000000-add-attendance';
import { AddAppeals1793700000000 } from './migrations/1793700000000-add-appeals';
import { StudentProfileLock1793900000000 } from './migrations/1793900000000-student-profile-lock';
import { AddDuesUnpaid1794000000000 } from './migrations/1794000000000-add-dues-unpaid';
import { DuesUnpaid } from '../dues/dues-unpaid.entity';

export const ENTITIES = [
  Unit, AdminUser, RefreshToken, SystemSetting, AuditLog, Event, EventQrToken, EventFacultyView,
  Device, Student, StudentDevice, Attendance, AttendanceFlag, AttendanceEdit, AttendanceJob, EventCounter, EventCodeFailure, Appeal,
  AcademicYear, ActivityCategory, ActivityCodeSequence, Activity, ActivityLink, ActivityCoUnit, ActivityEvent, ActivityVersion,
  WorkflowAction, Comment, Notification, DuesUnpaid,
];
export const MIGRATIONS = [
  InitSchema1793495899423, AddEvents1793500640024, AddEventFacultyView1793501916085, EventFacultyViewMode1793502499621,
  AddAttendance1793600000000, AddAppeals1793700000000, AddActivities1793800000000, StudentProfileLock1793900000000, AddDuesUnpaid1794000000000,
];

export function buildDbOptions(env: AppEnv): DataSourceOptions {
  return {
    type: 'mysql',
    host: env.db.host,
    port: env.db.port,
    username: env.db.user,
    password: env.db.password,
    database: env.db.name,
    // [BM] ket noi DB qua TLS khi bat DB_SSL
    ssl: env.db.ssl ? { rejectUnauthorized: true } : undefined,
    timezone: 'Z', // luu UTC trong DB - dac ta 11
    charset: 'utf8mb4',
    entities: ENTITIES,
    migrations: MIGRATIONS,
    synchronize: false, // schema chi thay doi qua migration
    extra: { connectionLimit: 20 },
  };
}

// dung cho typeorm CLI (migration:generate)
export default new DataSource(buildDbOptions(loadEnv()));
