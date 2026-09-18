# NHANES Research Agent

面向 NHANES 流行病学研究的网页 AI Agent。它把自然语言研究问题转换为可审计、可复现的研究流程：研究问题结构化、NHANES 周期和变量匹配、PubMed 检索、研究方案、复杂抽样分析、质量检查与报告生成。

## 快速运行

```bash
npm run dev
```

打开 `http://localhost:4173`。当前版本是无外部依赖的交互式 MVP，内置演示项目和可调用的研究工作流 API。

## 已实现

- 研究问题输入与 PEO/协变量/周期结构化识别（可选 DeepSeek，失败时安全回退）
- 六阶段 Agent 工作流与可见运行记录
- 初始问题解析、变量发现、PubMed 检索和方案生成支持并发去重；服务器重启后自动恢复停留在 running 的 Agent 项目
- 研究方案支持创建可追溯修订版：保留来源证据和模型配置、清空原批准签名，并在父子项目审计链中交叉记录
- 生产容器提供 SQLite 就绪探针和 25 秒优雅停机窗口；更新期间拒绝新任务，未完成任务由持久化队列恢复
- 所有耗时研究 API 提供分阶段过场动画、实时进度、已等待时间和可最小化后台状态；刷新页面后可恢复完整分析任务进度
- 完整分析、数据缓存和 R 进程支持安全取消；进度轮询遇到临时网络故障会自动退避重试
- 数据缓存、R 分析和一键执行队列持久化到 SQLite；服务器或容器重启后自动恢复未完成任务
- 研究审计事件使用 SHA-256 前向哈希链防篡改，验证结果与完整审计轨迹随分析结果包导出
- 可选的单研究员安全登录：scrypt 密码哈希、HMAC 签名 HttpOnly/SameSite 会话、CSRF 防护和登录限流；仓库不包含默认密码
- CDC 官方目录候选发现、概念—周期覆盖矩阵、跨周期兼容性提示、逐周期代码本取证与 SHA-256 审计
- 变量选择、缺失码/单位清洗规则和统计模型的分层人工确认
- PubMed E-utilities 实时检索、筛选和方法学摘要
- 官方 XPT 白名单下载、缓存、合并与可复现 R `survey` 分析
- 方案确认后可由执行 Agent 一键完成文件验证、数据缓存、R 分析、质量门和报告
- 原有维生素 D—PHQ-9 模板和经审核通用连续/二分类模型执行器
- 通用计数结局执行器：survey quasipoisson、发生率比、非负整数校验和离散参数质量检查
- 根据最小分析子样本自动推荐访谈或 MEC 权重，并按合并周期自动缩放
- 自动运行未调整模型和权重第 1–99 百分位截尾敏感性分析
- 自动生成所有模型变量的复杂抽样加权 Table 1 和未加权样本数
- 先定义完整复杂抽样设计，再以 `survey::subset` 进入目标人群和完整案例分析域，保留正确的子总体方差结构
- 逐变量缺失率、完整案例保留率、模型收敛/秩/条件数诊断
- 权重分布、设计自由度、分层/PSU 诊断，结构化报告和结果归档
- 研究方案导出与响应式布局
- 研究项目创建、运行、查询和确认 API
- SSE 实时 Agent 事件流
- 结构化领域校验、显式状态机与人工质量门
- DeepSeek 严格结构化输出、最多四轮格式修复与无密钥回退
- Node 原生测试覆盖领域契约和项目生命周期

## API

```text
GET  /api/health
GET  /api/health/ready
POST /api/projects
GET  /api/projects/:id
GET  /api/projects/:id/audit
POST /api/projects/:id/run
POST /api/projects/:id/fork
GET  /api/projects/:id/execute
POST /api/projects/:id/execute
GET  /api/projects/:id/events
POST /api/projects/:id/approve
POST /api/projects/:id/evidence
POST /api/projects/:id/candidate-selection
POST /api/projects/:id/codebook-review
GET  /api/projects/:id/cleaning-draft
POST /api/projects/:id/cleaning-approval
POST /api/projects/:id/weight-advice
POST /api/projects/:id/model-spec
GET  /api/projects/:id/analysis-package
GET  /api/projects/:id/analysis-package-download
GET  /api/projects/:id/data-manifest
POST /api/projects/:id/data-manifest-validate
GET  /api/projects/:id/data-cache
POST /api/projects/:id/data-cache
GET  /api/projects/:id/analysis-run
POST /api/projects/:id/analysis-run
GET  /api/projects/:id/analysis-quality
GET  /api/projects/:id/analysis-result-download
GET  /api/projects/:id/analysis-report
GET  /api/catalog/variables?q=vitamin
GET  /api/catalog/cdc?component=Laboratory&cycle=2017-2018&q=vitamin
POST /api/tools/pubmed/search
POST /api/tools/parse-question
```

已核验的维生素 D 演示方案使用内置注册表；其他研究问题从 CDC/NCHS 官方目录发现候选，正式分析前必须逐周期复核代码本并确认清洗规则。PubMed 工具通过 NCBI E-utilities 实时检索；建议配置 `NCBI_EMAIL`，高频使用时配置 `NCBI_API_KEY`。

分析包接口生成数据准备脚本、`model.R`、冻结配置和机器可读 QC 规则。只有变量、清洗、模型和研究方案摘要完全匹配时，通用执行器才会运行；任何失败都会保留为失败状态，不会把代码生成冒充成分析结果。

生产环境设置 `DATABASE_PATH=/data/nhanes.sqlite` 后，项目、审计事件和执行任务持久化到 SQLite。Compose 配置已挂载独立数据卷，容器更新不会删除项目数据；重启时未完成任务会从安全检查点重新排队。

### 启用安全登录

先在可信终端生成一次性随机管理员凭据：

```bash
npm run auth:generate
```

把输出的 `AUTH_USERNAME`、`AUTH_PASSWORD_HASH`、`AUTH_SESSION_SECRET` 和 `AUTH_COOKIE_SECURE` 写入服务器 `.env`；只保存 `ADMIN_PASSWORD` 给管理员本人，不要把它或生成结果提交到 Git。配置任一认证变量后，服务会要求全部认证参数有效，否则拒绝启动。公网部署应保留 `AUTH_COOKIE_SECURE=true` 并使用 HTTPS；仅本机 HTTP 调试时才设为 `false`。

## 测试

```bash
npm run check
```

完整生产架构、数据库、Agent 契约、统计规则和开发路线见 [ARCHITECTURE.md](ARCHITECTURE.md)。

Docker、HTTPS、GitHub 容器发布和服务器更新步骤见 [DEPLOYMENT.md](DEPLOYMENT.md)。

> 本项目用于研究辅助，不替代流行病学家和统计学家的独立复核。
