# NHANES Research Agent

面向 NHANES 流行病学研究的网页 AI Agent。它把自然语言研究问题转换为可审计、可复现的研究流程：研究问题结构化、NHANES 周期和变量匹配、PubMed 检索、研究方案、复杂抽样分析、质量检查与报告生成。

## 快速运行

```bash
npm run dev
```

打开 `http://localhost:4173`。当前版本是无外部依赖的交互式 MVP，内置演示项目和可调用的研究工作流 API。

## 已实现

- 研究问题输入与 PEO/协变量/周期识别演示
- 六阶段 Agent 工作流与可见运行记录
- NHANES 变量和数据文件映射
- PubMed 证据摘要区
- R `survey` / `nhanesA` 分析代码骨架
- 复杂抽样分析质量门与人工确认点
- 研究方案导出与响应式布局
- 研究项目创建、运行、查询和确认 API
- SSE 实时 Agent 事件流
- 结构化领域校验、显式状态机与人工质量门
- OpenAI Responses API 严格 Schema / 函数工具请求构造器
- Node 原生测试覆盖领域契约和项目生命周期

## API

```text
GET  /api/health
POST /api/projects
GET  /api/projects/:id
POST /api/projects/:id/run
GET  /api/projects/:id/events
POST /api/projects/:id/approve
POST /api/projects/:id/evidence
GET  /api/projects/:id/analysis-package
GET  /api/projects/:id/analysis-package-download
GET  /api/projects/:id/data-manifest
POST /api/projects/:id/data-manifest-validate
GET  /api/projects/:id/data-cache
POST /api/projects/:id/data-cache
GET  /api/projects/:id/analysis-run
POST /api/projects/:id/analysis-run
GET  /api/catalog/variables?q=vitamin
GET  /api/catalog/cdc?component=Laboratory&cycle=2017-2018&q=vitamin
POST /api/tools/pubmed/search
POST /api/tools/parse-question
```

变量目录当前为带来源声明的演示快照，正式分析前必须逐周期复核。PubMed 工具可通过 NCBI E-utilities 实时检索；建议配置 `NCBI_EMAIL`，高频使用时配置 `NCBI_API_KEY`。`src/openai-adapter.js` 定义了生产接入所需的结构化输出和工具契约，但不会在缺少 API Key 时静默调用模型。

分析包接口生成 `analysis.R`、冻结配置和机器可读 QC 规则。未检测到 R 运行环境时，状态始终是 `generated_not_executed`，系统不会把代码生成冒充成分析结果。

生产环境设置 `DATABASE_PATH=/data/nhanes.sqlite` 后，项目和审计事件持久化到 SQLite。Compose 配置已挂载独立数据卷，容器更新不会删除项目数据。

## 测试

```bash
npm run check
```

完整生产架构、数据库、Agent 契约、统计规则和开发路线见 [ARCHITECTURE.md](ARCHITECTURE.md)。

Docker、HTTPS、GitHub 容器发布和服务器更新步骤见 [DEPLOYMENT.md](DEPLOYMENT.md)。

> 本项目用于研究辅助，不替代流行病学家和统计学家的独立复核。
