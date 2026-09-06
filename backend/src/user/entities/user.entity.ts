import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 50, comment: '用户名' })
  username: string;

  @Column({ unique: true, length: 100, comment: '邮箱' })
  email: string;

  @Column({ length: 255, comment: '密码' })
  password: string;

  @Column({ length: 20, nullable: true, comment: '手机号' })
  phone: string;

  @Column({ length: 100, nullable: true, comment: '头像地址' })
  avatar: string;

  @Column({ default: 1, comment: '用户状态：0禁用 1正常' })
  status: number;

  @CreateDateColumn({ comment: '创建时间' })
  createTime: Date;

  @UpdateDateColumn({ comment: '更新时间' })
  updateTime: Date;
}
