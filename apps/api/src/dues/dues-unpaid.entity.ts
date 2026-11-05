// Sinh vien chua dong doan phi - hoi phi (danh sach do QTV Doan truong tai len)
import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity('dues_unpaid')
export class DuesUnpaid {
  @PrimaryColumn({ type: 'varchar', length: 20 })
  mssv: string;

  @Column({ name: 'created_by', type: 'varchar', length: 36, nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 6 })
  createdAt: Date;
}
