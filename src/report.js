const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const number = (value, digits = 3) => Number(value).toFixed(digits);
const pvalue = value => Number(value) < 0.001 ? '&lt;0.001' : number(value, 3);
function exposureRow(result) { return (result.coefficients || []).find(item => item.term === 'I(LBXVIDMS/10)'); }
function sensitivityRows(result) { return (result.sensitivityCoefficients || []).filter(item => (item.model === 'vitamin_d_quartiles' && String(item.term).includes('vitamin_quartile')) || (item.model === 'continuous_phq9' && item.term === 'I(LBXVIDMS/10)') || (item.model === 'sex_interaction' && String(item.term).includes(':'))); }
function effect(item) { return item.effect ?? item.odds_ratio; }
function flowSvg(result) { const flow = result.flow || {}, items = [['合并后记录', flow.merged], ['20岁以上', flow.adults], ['完整PHQ-9', flow.complete_phq9], ['最终分析样本', flow.analytic_complete_case]]; return `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="410" viewBox="0 0 760 410" role="img" aria-label="样本纳入流程图"><rect width="760" height="410" fill="#f5f5ef"/>${items.map((item,index)=>{const y=24+index*94;return `<rect x="180" y="${y}" width="400" height="62" rx="5" fill="#fff" stroke="#174f3b"/><text x="380" y="${y+25}" text-anchor="middle" font-family="sans-serif" font-size="15" fill="#17211d">${esc(item[0])}</text><text x="380" y="${y+48}" text-anchor="middle" font-family="sans-serif" font-size="18" font-weight="bold" fill="#174f3b">n = ${esc(item[1])}</text>${index<items.length-1?`<path d="M380 ${y+62} V${y+91}" stroke="#174f3b"/><path d="M374 ${y+84} L380 ${y+91} L386 ${y+84}" fill="none" stroke="#174f3b"/>`:''}`}).join('')}</svg>`; }
function forestSvg(result) { const primary = exposureRow(result), rows = [primary, ...sensitivityRows(result).filter(item => item.effect_type === 'odds_ratio')].filter(Boolean), labels = rows.map(item => item.model === 'primary' ? '连续维生素D（每10 nmol/L）' : item.term.replace('factor(vitamin_quartile)', '').replace('I(LBXVIDMS/10):factor(RIAGENDR)2', '性别交互')); const min=.65,max=1.25,x=value=>260+(Math.max(min,Math.min(max,Number(value)))-min)/(max-min)*430; return `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="${100+rows.length*58}" viewBox="0 0 760 ${100+rows.length*58}" role="img" aria-label="比值比森林图"><rect width="100%" height="100%" fill="#fff"/><text x="20" y="28" font-family="sans-serif" font-size="16" font-weight="bold">调整后比值比及95%置信区间</text><line x1="${x(1)}" y1="48" x2="${x(1)}" y2="${70+rows.length*58}" stroke="#9aa49e" stroke-dasharray="4 4"/>${rows.map((item,index)=>{const y=68+index*58;return `<text x="20" y="${y+5}" font-family="sans-serif" font-size="12">${esc(labels[index])}</text><line x1="${x(item.ci_low)}" y1="${y}" x2="${x(item.ci_high)}" y2="${y}" stroke="#174f3b" stroke-width="3"/><circle cx="${x(effect(item))}" cy="${y}" r="5" fill="#174f3b"/><text x="705" y="${y+5}" text-anchor="end" font-family="monospace" font-size="11">${number(effect(item))} (${number(item.ci_low)}–${number(item.ci_high)})</text>`}).join('')}<line x1="260" y1="${76+rows.length*58}" x2="690" y2="${76+rows.length*58}" stroke="#17211d"/><text x="260" y="${94+rows.length*58}" font-family="monospace" font-size="10">${min}</text><text x="${x(1)}" y="${94+rows.length*58}" text-anchor="middle" font-family="monospace" font-size="10">1.00</text><text x="690" y="${94+rows.length*58}" text-anchor="end" font-family="monospace" font-size="10">${max}</text></svg>`; }
function approvalDecisions(project) { return project.protocol?.decisions || project.approvals?.at(-1)?.decisions || {}; }
function markdownReport(project, result) { const main = exposureRow(result), sensitivity = sensitivityRows(result), flow = result.flow || {}, decisions = approvalDecisions(project); return `# ${project.title || 'NHANES 流行病学研究报告'}

> 状态：真实 R 分析已完成；本报告描述横断面关联，不支持因果推断。

## 研究问题

${project.question}

## 数据与方法

- 数据：NHANES ${(project.intent?.cycles || []).join('、')}
- 人群：美国 ${project.intent?.population?.ageMin || 18} 岁以上成年人
- 暴露：血清总 25(OH)D（LBXVIDMS，nmol/L）
- 结局：PHQ-9 总分 ≥10；连续 PHQ-9 为敏感性分析
- 抽样设计：SDMVPSU、SDMVSTRA；合并权重 ${result.weightRule}
- 主模型：复杂抽样加权 quasibinomial logistic regression
- 调整变量：年龄、性别、种族/族裔、贫困收入比、BMI

## 研究者冻结决策

${Object.entries(decisions).map(([key,value])=>`- ${key}：${value}`).join('\n') || '- 此项目创建于方案冻结功能上线之前。'}

## 样本流程

| 阶段 | n |
|---|---:|
| 合并后记录 | ${flow.merged} |
| 成年人 | ${flow.adults} |
| 完整 PHQ-9 | ${flow.complete_phq9} |
| 最终完整案例 | ${flow.analytic_complete_case} |
| 抑郁病例 | ${flow.depression_cases} |

## 主要结果

每升高 10 nmol/L 的血清 25(OH)D，抑郁症状 OR=${number(effect(main))}（95% CI ${number(main.ci_low)}–${number(main.ci_high)}，P=${number(main.p_value,4)}）。

## 敏感性分析

| 模型 | 项目 | 效应 | 95% CI | P |
|---|---|---:|---:|---:|
${sensitivity.map(item=>`| ${item.model} | ${item.term} | ${number(effect(item))} | ${number(item.ci_low)}–${number(item.ci_high)} | ${number(item.p_value,4)} |`).join('\n')}

## 局限性

${(result.warnings || []).map(item=>`- ${item}`).join('\n')}

## 复现信息

- ${result.runtime?.rVersion}
- survey ${result.runtime?.surveyVersion}；haven ${result.runtime?.havenVersion}
- 完成时间：${result.runtime?.completedAt}
`; }
function htmlReport(project, result) { const markdown = markdownReport(project, result), main = exposureRow(result), sensitivity = sensitivityRows(result), flow = result.flow || {}, decisions = approvalDecisions(project); return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(project.title)} · NHANES 报告</title><style>body{font:15px/1.65 Arial,"Microsoft YaHei",sans-serif;color:#17211d;max-width:980px;margin:36px auto;padding:0 24px}h1,h2{font-family:Georgia,"Microsoft YaHei",serif;color:#174f3b}header{border-bottom:2px solid #174f3b}.notice{background:#fbf3e7;padding:12px;border:1px solid #edddc4}table{width:100%;border-collapse:collapse;margin:14px 0}th,td{padding:8px;border-bottom:1px solid #dfe3dc;text-align:left}th{background:#edf3e3}figure{margin:28px 0;overflow:auto}code{background:#edf3ee;padding:2px 4px}@media print{body{margin:0;max-width:none}.no-print{display:none}}</style></head><body><header><h1>${esc(project.title)}</h1><p>${esc(project.question)}</p></header><p class="notice">真实 R 分析已完成。本报告仅描述横断面关联，不支持因果推断。</p><h2>数据与方法</h2><ul><li>NHANES 周期：${esc((project.intent?.cycles||[]).join('、'))}</li><li>目标人群：美国 ${esc(project.intent?.population?.ageMin||18)} 岁以上成年人</li><li>暴露：LBXVIDMS，每 10 nmol/L</li><li>结局：PHQ-9 ≥10</li><li>复杂抽样：SDMVPSU、SDMVSTRA，${esc(result.weightRule)}</li><li>调整：年龄、性别、种族/族裔、PIR、BMI</li></ul><h2>研究者冻结决策</h2><ul>${Object.entries(decisions).map(([key,value])=>`<li><code>${esc(key)}</code>：${esc(value)}</li>`).join('')||'<li>此项目创建于方案冻结功能上线之前。</li>'}</ul><h2>样本流程</h2><figure>${flowSvg(result)}</figure><p>最终分析 ${esc(flow.analytic_complete_case)} 人，其中抑郁病例 ${esc(flow.depression_cases)} 人。</p><h2>主要结果</h2><p>每升高 10 nmol/L，OR <b>${number(effect(main))}</b>（95% CI ${number(main.ci_low)}–${number(main.ci_high)}，P=${number(main.p_value,4)}）。</p><figure>${forestSvg(result)}</figure><h2>敏感性分析</h2><table><thead><tr><th>模型</th><th>项目</th><th>效应</th><th>95% CI</th><th>P</th></tr></thead><tbody>${sensitivity.map(item=>`<tr><td>${esc(item.model)}</td><td>${esc(item.term)}</td><td>${number(effect(item))}</td><td>${number(item.ci_low)}–${number(item.ci_high)}</td><td>${pvalue(item.p_value)}</td></tr>`).join('')}</tbody></table><h2>局限性</h2><ul>${(result.warnings||[]).map(item=>`<li>${esc(item)}</li>`).join('')}</ul><h2>复现信息</h2><p>${esc(result.runtime?.rVersion)}；survey ${esc(result.runtime?.surveyVersion)}；haven ${esc(result.runtime?.havenVersion)}；${esc(result.runtime?.completedAt)}</p><p class="no-print">可使用浏览器的“打印”功能另存为 PDF。</p><!-- markdown-bytes:${Buffer.byteLength(markdown)} --></body></html>`; }
module.exports = { exposureRow, sensitivityRows, flowSvg, forestSvg, markdownReport, htmlReport };
