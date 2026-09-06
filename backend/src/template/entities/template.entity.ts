import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export interface SizeVariant {
  name: string;
  width: number;
  height: number;
  psdUrl: string;
  cover: string;
  layers: any[];
}

@Entity('templates')
export class Template {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ comment: '用户ID' })
  userId: number;

  @Column({ length: 100, comment: '模板名称' })
  name: string;

  @Column({ length: 50, nullable: true, comment: '分类' })
  category: string;

  @Column({ length: 255, nullable: true, comment: '模板封面图地址' })
  cover: string;

  @Column({ length: 255, comment: 'PSD文件地址' })
  psdUrl: string;

  @Column({ type: 'int', default: 0, comment: 'PSD宽度' })
  width: number;

  @Column({ type: 'int', default: 0, comment: 'PSD高度' })
  height: number;

  @Column({ type: 'json', comment: '解析出来的图层信息' })
  layers: any;

  @Column({ type: 'json', comment: '绑定的尺寸列表' })
  sizes: Array<{
    name: string;
    width: number;
    height: number;
  }>;

  @Column({ type: 'json', nullable: true, comment: '多尺寸变体（每个尺寸一个PSD）' })
  sizeVariants: SizeVariant[];

  @Column({ default: 1, comment: '状态：0禁用 1正常' })
  status: number;

  @Column({ default: 0, comment: '收藏数量' })
  favoriteCount: number;

  @CreateDateColumn({ comment: '创建时间' })
  createTime: Date;

  @UpdateDateColumn({ comment: '更新时间' })
  updateTime: Date;
}
