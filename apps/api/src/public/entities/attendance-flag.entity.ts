// Co bat thuong cua luot diem danh - dac ta 5.3, 6 (attendance_flags)
// Chi them, khong tu xoa: sua thong tin co the them co moi, nguoi duyet quyet dinh co bo qua hay khong.
import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Attendance } from './attendance.entity';

export type FlagCode =
  | 'DUPLICATE_MSSV' | 'DEVICE_MULTI_MSSV' | 'MSSV_MULTI_DEVICE' | 'NAME_MISMATCH' | 'FACULTY_MISMATCH'
  | 'NEW_DEVICE' | 'BURST_SAME_FINGERPRINT' | 'GPS_OUTSIDE' | 'GPS_LOW_ACCURACY' | 'GPS_MISSING'
  | 'NO_CHECKOUT' | 'MANUAL_ENTRY' | 'DUES_UNPAID';

@Index('UQ_attendance_flags_code', ['attendanceId', 'code'], { unique: true })
@Entity('attendance_flags')
export class AttendanceFlag {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'attendance_id', type: 'char', length: 36 })
  attendanceId: string;

  @ManyToOne(() => Attendance, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'attendance_id' })
  attendance?: Attendance;

  @Column({ type: 'varchar', length: 30 })
  code: FlagCode;

  @Column({ name: 'detail_json', type: 'json', nullable: true })
  detailJson: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 6 })
  createdAt: Date;
}
