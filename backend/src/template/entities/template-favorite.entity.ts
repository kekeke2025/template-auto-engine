import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Unique } from 'typeorm';

@Entity('template_favorites')
@Unique(['userId', 'templateId'])
export class TemplateFavorite {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ comment: '用户ID' })
  userId: number;

  @Column({ comment: '模板ID' })
  templateId: number;

  @CreateDateColumn({ comment: '收藏时间' })
  createTime: Date;
}
