import { MigrationInterface, QueryRunner } from "typeorm";

// Danh sach sinh vien chua dong doan phi - hoi phi (QTV Doan truong tai len) + loi canh bao do QTV soan.
// Viet tay. Chi dung de gan co va canh bao, khong tu dong tru diem ren luyen.
export class AddDuesUnpaid1794000000000 implements MigrationInterface {
    name = 'AddDuesUnpaid1794000000000'

    public async up(q: QueryRunner): Promise<void> {
        await q.query("CREATE TABLE `dues_unpaid` (`mssv` varchar(20) NOT NULL, `created_by` varchar(36) NULL, `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), PRIMARY KEY (`mssv`)) ENGINE=InnoDB");
        await q.query("INSERT INTO `system_settings` (`key`, `value_json`) VALUES (?, ?)", [
            'dues_warning_message',
            JSON.stringify('Bạn chưa đóng đoàn phí - hội phí. Ban tổ chức chỉ lưu vết điểm danh, không ghi nhận điểm rèn luyện. Vui lòng liên hệ BTC chương trình.'),
        ]);
    }

    public async down(q: QueryRunner): Promise<void> {
        await q.query("DELETE FROM `system_settings` WHERE `key` = 'dues_warning_message'");
        await q.query("DROP TABLE `dues_unpaid`");
    }
}
