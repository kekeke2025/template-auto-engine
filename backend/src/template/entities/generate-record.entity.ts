import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

@Entity('generate_records')
export class GenerateRecord {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ comment: '用户ID' })
  userId: number;

  @Column({ comment: '模板ID' })
  templateId: number;

  @Column({ type: 'json', comment: '替换内容' })
  replaceContent: any;

  @Column({ type: 'json', comment: '生成结果（图片URL列表）' })
  results: Array<{
    sizeName: string;
    width: number;
    height: number;
    url: string;
    fileSize?: number;
  }>;

  @Column({ length: 500, nullable: true, comment: '打包下载ZIP地址' })
  zipUrl: string;

  @Column({ default: 1, comment: '状态：0失败 1成功' })
  status: number;

  @Column({ type: 'text', nullable: true, comment: '失败原因' })
  failReason: string;

  @CreateDateColumn({ comment: '生成时间' })
  createTime: Date;
}
