# NHANES Research Agent：产品与技术设计

## 信息架构

核心对象为“研究项目”，下含研究问题、结构化方案、数据清单、变量映射、文献集合、分析版本、运行记录、质量检查和报告。

`问题澄清 → PEO/周期/人群解析 → 数据与变量匹配 → PubMed 检索 → 证据综合 → 方案冻结 → 沙箱分析 → QC → 报告`

页面包括研究首页、项目工作台、变量词典、文献证据、代码与运行、质量检查、报告预览及项目设置。任何改变样本定义、权重或主模型的决定都形成新版本并要求研究者确认。

## 技术栈与前后端架构

- 前端：Next.js + TypeScript + Tailwind/Radix；TanStack Query 管理长任务，Monaco 展示代码。
- API：FastAPI + Pydantic；SSE 推送步骤事件，OpenAPI 作为前后端契约。
- 编排：显式状态机（LangGraph 可选），各阶段只接收/输出版本化 JSON Schema。
- 模型：OpenAI Responses API；结构化输出负责研究对象，强类型函数工具负责检索、元数据查询和任务提交。
- 任务：Temporal 或 Celery/Redis；R 分析在限时、限资源、默认无网络的隔离容器运行。
- 数据：PostgreSQL（业务/审计）、S3/MinIO（XPT、报告、产物）、pgvector（变量和文献语义检索）。
- 分析：R `survey`、`nhanesA`、`mice`、`rms`；Python 负责 ETL、目录和服务层。
- 可观测：OpenTelemetry + Sentry + Prometheus；记录提示版本、模型、数据哈希和随机种子。

OpenAI Responses API 支持内置工具、自定义函数工具、并行调用和结构化输出，适合把模型判断与确定性分析服务分离。LLM 不直接访问数据库，也不运行任意代码。

## Agent 编排

1. **Intent Agent**：输出 population、exposure、outcome、covariates、cycles、estimand、ambiguities。
2. **NHANES Catalog Tool**：检索真实变量，返回文件、单位、编码、适用人群、权重和文档来源。
3. **Variable Resolver**：按语义、周期覆盖、测量一致性和组件兼容性评分；生成逐周期谐调规则，禁止编造变量。
4. **Literature Agent**：生成并保存 PubMed 查询；去重、排序并结构化抽取证据。
5. **Methodologist Agent**：围绕 estimand 和 DAG 给出最小/扩展调整集、主次模型、亚组和敏感性分析。
6. **Code Agent**：从冻结的 `AnalysisSpec` 模板生成 R 项目、锁文件、字典和 session info。
7. **Runner**：隔离执行，产出机器可读结果、日志、表格、图和样本流图。
8. **QC Agent + 规则引擎**：检查权重、PSU、自由度、缺失、收敛和表图一致性。
9. **Report Agent**：只引用通过 QC 的结果对象，不得自行生成数字。

人工门设在变量确认、方案冻结和报告发布；失败从不可变检查点重试。

## 数据库

- `projects(id, owner_id, title, status, created_at)`
- `research_questions(id, project_id, raw_text, structured_json, schema_version)`
- `nhanes_cycles(id, label, years, release, catalog_snapshot)`
- `datasets(id, cycle_id, component, file_code, url, doc_hash)`
- `variables(id, dataset_id, name, label, unit, value_map_json, missing_codes_json)`
- `concepts(id, preferred_term, synonyms, ontology_ids)`
- `variable_mappings(id, project_id, concept_id, variable_id, role, score, rationale, status)`
- `literature_queries(id, project_id, query, filters_json, executed_at)`
- `articles(pmid, doi, title, abstract, year, metadata_json)`
- `analysis_specs(id, project_id, version, spec_json, frozen_at)`
- `runs(id, spec_id, image_digest, seed, status, started_at, finished_at)`
- `artifacts(id, run_id, kind, uri, sha256, metadata_json)`
- `qc_checks(id, run_id, rule, severity, status, evidence_json)`
- `audit_events(id, project_id, actor, event_type, payload_json, created_at)`

重要记录追加而非覆盖，并保存来源 ID、模型/提示版本和 schema 版本。

## 变量映射与 PubMed

离线同步 CDC/NCHS 数据页、代码本和 XPT 头信息，构建“概念 → 候选变量 → 周期文件”图。重排关注周期完整度、组件权重、单位、实验室方法变化、跳题逻辑、年龄范围和公共数据可用性。结果必须列出逐周期变量名、换算、分类合并、特殊缺失码、检测限和权重来源。跨周期不可比时应缩短周期或预设校准，不能静默拼接。

PubMed 查询由 `(exposure MeSH/同义词) AND (outcome MeSH/同义词) AND (NHANES OR National Health and Nutrition Examination Survey)` 构成；方法问题增加 survey weights、cross-sectional 或 spline。通过 NCBI E-utilities 检索并保存查询、时间和 PMID 集。逐篇抽取周期、样本、人群、定义、协变量、权重、模型、效应与局限；缺失字段标记“未报告”，不推断。

## 统计分析规则

- 先定义 estimand；横断面结果表述为关联而非因果。
- 选择最小分析子样本对应权重；合并 K 个常规两年周期通常使用 `WT*2YR / K`，特殊周期按 NCHS 指南。
- 使用 `svydesign(ids=~SDMVPSU, strata=~SDMVSTRA, weights=~weight, nest=TRUE)`；检查孤立 PSU、设计自由度和 domain analysis。
- 描述、模型、方差和检验均采用 survey-aware 方法，不用普通 GLM 替代。
- 预设连续/分类编码、非线性、交互、多重比较、缺失策略和敏感性分析；报告加权估计、95% CI 与未加权 n。
- 多重插补包含设计变量，在各插补数据集上运行 survey 模型后合并；结构性缺失不按随机缺失处理。

## 结果校验与错误防护

硬校验：变量存在；SEQN 唯一性/连接膨胀；周期覆盖；单位和缺失码；权重适配；PSU/strata；样本流守恒；模型收敛；有效自由度；估计和 CI 合法；表图同源。

执行器只允许模板化或 AST 白名单代码；容器使用只读数据卷、默认无网络和资源限额；密钥不进入代码或日志；下载校验域名、类型、大小和哈希。文献和代码本按不可信输入处理。模型不确定时暂停确认，绝不补造变量、PMID、样本量或效应值。

## API 与后续步骤

核心接口：`POST /projects`、`POST /projects/{id}/parse`、`POST /projects/{id}/variables:resolve`、`POST /projects/{id}/literature:search`、`POST /projects/{id}/specs`、`POST /specs/{id}/runs`、`GET /runs/{id}/events`、`POST /runs/{id}/qc`、`POST /projects/{id}/reports`。

开发顺序：CDC 元数据同步器 → Pydantic 领域契约和状态机 → PubMed 检索与审计 → R 沙箱与黄金测试 → 前端接入 SSE、方案 diff 和人工确认 → Quarto 报告 → 统计复核和安全测试。上线标准是同一冻结方案和数据快照可重复，并且每个数字可追溯到代码、数据哈希、运行和 QC 证据。
