# NHANES Research Agent

面向 NHANES 流行病学研究的网页 AI Agent。它把自然语言研究问题转换为可审计、可复现的研究流程：研究问题结构化、NHANES 周期和变量匹配、PubMed 检索、研究方案、复杂抽样分析、质量检查与报告生成。

## 快速运行

```bash
npm run dev
```

打开 `http://localhost:4173`。当前版本是无外部依赖的交互式 MVP，内置“血清维生素 D 与抑郁症状”演示项目。

## 已实现

- 研究问题输入与 PEO/协变量/周期识别演示
- 六阶段 Agent 工作流与可见运行记录
- NHANES 变量和数据文件映射
- PubMed 证据摘要区
- R `survey` / `nhanesA` 分析代码骨架
- 复杂抽样分析质量门与人工确认点
- 研究方案导出与响应式布局

完整生产架构、数据库、Agent 契约、统计规则和开发路线见 [ARCHITECTURE.md](ARCHITECTURE.md)。

> 本项目用于研究辅助，不替代流行病学家和统计学家的独立复核。
