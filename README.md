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
- CDC 官方目录候选发现、概念—周期覆盖矩阵、跨周期兼容性提示、逐周期代码本取证与 SHA-256 审计
- 变量选择、缺失码/单位清洗规则和统计模型的分层人工确认
- PubMed E-utilities 实时检索、筛选和方法学摘要
- 官方 XPT 白名单下载、缓存、合并与可复现 R `survey` 分析
- 方案确认后可由执行 Agent 一键完成文件验证、数据缓存、R 分析、质量门和报告
- 原有维生素 D—PHQ-9 模板和经审核通用连续/二分类模型执行器
- 根据最小分析子样本自动推荐访谈或 MEC 权重，并按合并周期自动缩放
- 自动运行未调整模型和权重第 1–99 百分位截尾敏感性分析
- 自动生成所有模型变量的复杂抽样加权 Table 1 和未加权样本数
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
POST /api/projects
GET  /api/projects/:id
POST /api/projects/:id/run
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

生产环境设置 `DATABASE_PATH=/data/nhanes.sqlite` 后，项目和审计事件持久化到 SQLite。Compose 配置已挂载独立数据卷，容器更新不会删除项目数据。

## 测试

```bash
npm run check
```

完整生产架构、数据库、Agent 契约、统计规则和开发路线见 [ARCHITECTURE.md](ARCHITECTURE.md)。

Docker、HTTPS、GitHub 容器发布和服务器更新步骤见 [DEPLOYMENT.md](DEPLOYMENT.md)。

> 本项目用于研究辅助，不替代流行病学家和统计学家的独立复核。
