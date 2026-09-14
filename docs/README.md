# 版式自动化引擎

一款面向内容运营、新媒体从业者的智能批量出图工具，通过PSD模板一键生成多尺寸封面图，大幅提升对外不同类型素材制作效率。

## 项目结构
```
.
├── frontend/          # 前端项目（React + TypeScript + Vite）
├── backend/           # 后端项目（NestJS + MySQL + Redis）
├── docs/              # 项目文档
├── docker-compose.yml # 本地开发环境容器配置
└── README.md
```

## 技术栈
### 前端
- React 18 + TypeScript
- Vite 构建工具
- Ant Design UI组件库
- Axios 网络请求
- React Router 路由管理
- Zustand 状态管理

### 后端
- NestJS 企业级Node.js框架
- MySQL 关系型数据库
- Redis 缓存数据库
- TypeORM ORM框架
- JWT 鉴权
- MCP插件对接（PSD解析、图片渲染）

## 本地开发环境搭建
### 前置依赖
- Node.js 18+
- pnpm 8+
- Docker + Docker Compose（可选，用于快速启动数据库）

### 步骤1：启动数据库（使用Docker）
```bash
docker-compose up -d
```
启动后服务地址：
- MySQL: localhost:3306
- Redis: localhost:6379

### 步骤2：启动后端服务
```bash
cd backend
pnpm install
cp .env.example .env
# 配置.env中的数据库连接、MCP插件、OSS等信息
pnpm start:dev
```
后端服务启动地址：http://localhost:3001

### 步骤3：启动前端服务
```bash
cd frontend
pnpm install
cp .env.example .env
pnpm dev
```
前端服务启动地址：http://localhost:3000

## 项目文档
- [产品需求文档](docs/产品需求文档.md)
- [竞品分析报告](docs/竞品分析报告.md)
- [系统架构设计](docs/系统架构设计.md)
- [MVP开发Roadmap](docs/MVP开发Roadmap.md)
- [MCP插件接入指南](docs/MCP插件接入指南.md)

## 核心功能
1. ✅ PSD模板上传解析，自动识别可编辑图层
2. ✅ 模板多尺寸规格绑定
3. ✅ 一键批量生成所有尺寸封面
4. ✅ 批量打包下载
5. ✅ 生成记录管理、模板收藏
6. 🚧 在线精细化编辑（后续迭代）
7. 🚧 团队协作、模板共享（后续迭代）

## 开发规范
- 前后端代码都使用TypeScript，保证类型安全
- 遵循ESLint代码规范
- 接口返回统一格式：{ code: number, message: string, data: any }
- Git提交遵循Conventional Commits规范
