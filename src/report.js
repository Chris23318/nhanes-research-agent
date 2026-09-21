const { buildInterpretation } = require('./report-interpretation');
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const number = (value, digits = 3) => Number(value).toFixed(digits);
const pvalue = value => Number(value) < 0.001 ? '&lt;0.001' : number(value, 3);
function exposureRow(result) { return (result.coefficients || []).find(item => item.term === 'I(LBXVIDMS/10)'); }
function sensitivityRows(result) { return (result.sensitivityCoefficients || []).filter(item => (item.model === 'vitamin_d_quartiles' && String(item.term).includes('vitamin_quartile')) || (item.model === 'continuous_phq9' && item.term === 'I(LBXVIDMS/10)') || (item.model === 'sex_interaction' && String(item.term).includes(':'))); }
function effect(item) { return item?.effect ?? item?.odds_ratio; }
const isGeneric = result => String(result?.analysisMode || '').startsWith('generic_survey_v');
function flowSvg(result) { const flow = result.flow || {}, items = isGeneric(result)?[['合并后记录',flow.merged],['符合目标年龄',flow.population_eligible],['最终完整案例',flow.analytic_complete_case]]:[['合并后记录', flow.merged], ['20岁以上', flow.adults], ['完整PHQ-9', flow.complete_phq9], ['最终分析样本', flow.analytic_complete_case]]; const height=34+items.length*94;return `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="${height}" viewBox="0 0 760 ${height}" role="img" aria-label="样本纳入流程图"><rect width="760" height="${height}" fill="#f5f5ef"/>${items.map((item,index)=>{const y=18+index*94;return `<rect x="180" y="${y}" width="400" height="62" rx="5" fill="#fff" stroke="#174f3b"/><text x="380" y="${y+25}" text-anchor="middle" font-family="sans-serif" font-size="15" fill="#17211d">${esc(item[0])}</text><text x="380" y="${y+48}" text-anchor="middle" font-family="sans-serif" font-size="18" font-weight="bold" fill="#174f3b">n = ${esc(item[1])}</text>${index<items.length-1?`<path d="M380 ${y+62} V${y+91}" stroke="#174f3b"/><path d="M374 ${y+84} L380 ${y+91} L386 ${y+84}" fill="none" stroke="#174f3b"/>`:''}`}).join('')}</svg>`; }
function forestSvg(result) { if(isGeneric(result)){const item=(result.coefficients||[]).find(row=>row.term==='analysis_exposure');if(!item)return '<svg xmlns="http://www.w3.org/2000/svg" width="760" height="80"><text x="20" y="40">No exposure estimate</text></svg>';const low=Number(item.ci_low),high=Number(item.ci_high),span=Math.max(high-low,Math.abs(Number(effect(item)))*.2,.1),min=low-span*.2,max=high+span*.2,x=value=>220+(Number(value)-min)/(max-min)*430;return `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="130" viewBox="0 0 760 130" role="img" aria-label="主暴露效应图"><rect width="100%" height="100%" fill="#fff"/><text x="20" y="28" font-family="sans-serif" font-size="16" font-weight="bold">主暴露效应及95%置信区间</text><text x="20" y="72" font-family="sans-serif" font-size="13">analysis_exposure</text><line x1="${x(low)}" y1="68" x2="${x(high)}" y2="68" stroke="#174f3b" stroke-width="3"/><circle cx="${x(effect(item))}" cy="68" r="5" fill="#174f3b"/><text x="735" y="72" text-anchor="end" font-family="monospace" font-size="12">${number(effect(item))} (${number(low)}–${number(high)})</text></svg>`} const primary = exposureRow(result), rows = [primary, ...sensitivityRows(result).filter(item => item.effect_type === 'odds_ratio')].filter(Boolean), labels = rows.map(item => item.model === 'primary' ? '连续维生素D（每10 nmol/L）' : item.term.replace('factor(vitamin_quartile)', '').replace('I(LBXVIDMS/10):factor(RIAGENDR)2', '性别交互')); const min=.65,max=1.25,x=value=>260+(Math.max(min,Math.min(max,Number(value)))-min)/(max-min)*430; return `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="${100+rows.length*58}" viewBox="0 0 760 ${100+rows.length*58}" role="img" aria-label="比值比森林图"><rect width="100%" height="100%" fill="#fff"/><text x="20" y="28" font-family="sans-serif" font-size="16" font-weight="bold">调整后比值比及95%置信区间</text><line x1="${x(1)}" y1="48" x2="${x(1)}" y2="${70+rows.length*58}" stroke="#9aa49e" stroke-dasharray="4 4"/>${rows.map((item,index)=>{const y=68+index*58;return `<text x="20" y="${y+5}" font-family="sans-serif" font-size="12">${esc(labels[index])}</text><line x1="${x(item.ci_low)}" y1="${y}" x2="${x(item.ci_high)}" y2="${y}" stroke="#174f3b" stroke-width="3"/><circle cx="${x(effect(item))}" cy="${y}" r="5" fill="#174f3b"/><text x="705" y="${y+5}" text-anchor="end" font-family="monospace" font-size="11">${number(effect(item))} (${number(item.ci_low)}–${number(item.ci_high)})</text>`}).join('')}<line x1="260" y1="${76+rows.length*58}" x2="690" y2="${76+rows.length*58}" stroke="#17211d"/><text x="260" y="${94+rows.length*58}" font-family="monospace" font-size="10">${min}</text><text x="${x(1)}" y="${94+rows.length*58}" text-anchor="middle" font-family="monospace" font-size="10">1.00</text><text x="690" y="${94+rows.length*58}" text-anchor="end" font-family="monospace" font-size="10">${max}</text></svg>`; }
function missingnessSvg(result){const rows=(result.missingnessDiagnostics||[]).filter(row=>Number.isFinite(Number(row.missing_pct))).sort((a,b)=>Number(b.missing_pct)-Number(a.missing_pct)).slice(0,8);if(!rows.length)return'';const height=70+rows.length*42,max=Math.max(5,...rows.map(row=>Number(row.missing_pct))),width=value=>Math.max(1,390*Number(value)/max);return `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="${height}" viewBox="0 0 760 ${height}" role="img" aria-label="变量缺失率图"><rect width="760" height="${height}" fill="#fff"/><text x="20" y="26" font-family="sans-serif" font-size="16" font-weight="bold" fill="#17211d">分析字段缺失率</text>${rows.map((row,index)=>{const y=48+index*42;return `<text x="20" y="${y+15}" font-family="sans-serif" font-size="12" fill="#17211d">${esc(row.variable)}</text><rect x="230" y="${y}" width="390" height="20" rx="3" fill="#edf3ee"/><rect x="230" y="${y}" width="${width(row.missing_pct)}" height="20" rx="3" fill="#2a7f62"/><text x="635" y="${y+15}" font-family="sans-serif" font-size="12" fill="#17211d">${number(row.missing_pct,1)}%</text>`}).join('')}</svg>`;}
function subgroupForestSvg(result){const rows=(result.subgroupAnalyses||[]).filter(row=>[effect(row),row.ci_low,row.ci_high].every(value=>Number.isFinite(Number(value)))).slice(0,20);if(!rows.length)return'';const ratio=rows.some(row=>['odds_ratio','rate_ratio','risk_ratio'].includes(row.effect_type)),nullValue=ratio?1:0,min=Math.min(nullValue,...rows.map(row=>Number(row.ci_low))),max=Math.max(nullValue,...rows.map(row=>Number(row.ci_high))),padding=Math.max((max-min)*.08,.05),lo=min-padding,hi=max+padding,x=value=>300+(Number(value)-lo)/(hi-lo)*330,height=76+rows.length*38;return `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="${height}" viewBox="0 0 760 ${height}" role="img" aria-label="亚组分析森林图"><rect width="760" height="${height}" fill="#fff"/><text x="20" y="26" font-family="sans-serif" font-size="16" font-weight="bold" fill="#17211d">亚组效应及95%置信区间</text><line x1="${x(nullValue)}" y1="42" x2="${x(nullValue)}" y2="${height-22}" stroke="#8a9790" stroke-dasharray="4 4"/>${rows.map((row,index)=>{const y=58+index*38;return `<text x="20" y="${y+4}" font-family="sans-serif" font-size="11" fill="#17211d">${esc(`${row.subgroup} · ${row.level}`)}</text><line x1="${x(row.ci_low)}" y1="${y}" x2="${x(row.ci_high)}" y2="${y}" stroke="#2a7f62" stroke-width="3"/><circle cx="${x(effect(row))}" cy="${y}" r="5" fill="#c77d2a"/><text x="742" y="${y+4}" text-anchor="end" font-family="monospace" font-size="10" fill="#17211d">${number(effect(row))} (${number(row.ci_low)}–${number(row.ci_high)})</text>`}).join('')}</svg>`;}
function approvalDecisions(project) { return project.protocol?.decisions || project.approvals?.at(-1)?.decisions || {}; }
function genericCovariates(spec){return (spec.covariates||[]).map(x=>`${x.concept}（${x.encoding}；${(x.mappings||[]).map(m=>`${m.cycles?.[0]} ${m.variable}`).join(' / ')}）`).join('、')||'未调整模型';}
function descriptiveLabel(spec,name){if(name==='analysis_exposure')return'暴露';if(name==='analysis_outcome')return'结局';const match=/^cov_(\d+)$/.exec(name);return match?spec.covariates?.[Number(match[1])-1]?.concept||name:name;}
function advancedMarkdown(result){const nonlinear=result.nonlinearAnalysis||{},subgroups=Array.isArray(result.subgroupAnalyses)?result.subgroupAnalyses:[];if(nonlinear.method!=='restricted_cubic_spline'&&!subgroups.length)return'';const lines=['## 高级分析'];if(nonlinear.method==='restricted_cubic_spline')lines.push(`- 限制性立方样条：df=${nonlinear.df}；线性与样条模型比较 P=${pvalue(nonlinear.p_value)}。`);if(subgroups.length){lines.push('','| 亚组变量 | 层 | 未加权 n | 效应 | 95% CI | P | 交互 P |','|---|---|---:|---:|---:|---:|---:|',...subgroups.map(row=>`| ${mdCell(row.subgroup)} | ${mdCell(row.level)} | ${mdCell(row.unweighted_n)} | ${number(effect(row))} | ${number(row.ci_low)}–${number(row.ci_high)} | ${pvalue(row.p_value)} | ${pvalue(row.interaction_p)} |`));lines.push('','> 亚组和交互分析为探索性结果，未进行多重性校正。')}return `${lines.join('\n')}\n\n`}
function advancedHtml(result){const nonlinear=result.nonlinearAnalysis||{},subgroups=Array.isArray(result.subgroupAnalyses)?result.subgroupAnalyses:[];if(nonlinear.method!=='restricted_cubic_spline'&&!subgroups.length)return'';return `<h2>高级分析</h2>${nonlinear.method==='restricted_cubic_spline'?`<p>限制性立方样条：df=${esc(nonlinear.df)}；线性与样条模型比较 P=${pvalue(nonlinear.p_value)}。</p>`:''}${subgroups.length?`<table><thead><tr><th>亚组</th><th>层</th><th>n</th><th>效应</th><th>95% CI</th><th>P</th><th>交互 P</th></tr></thead><tbody>${subgroups.map(row=>`<tr><td>${esc(row.subgroup)}</td><td>${esc(row.level)}</td><td>${esc(row.unweighted_n)}</td><td>${number(effect(row))}</td><td>${number(row.ci_low)}–${number(row.ci_high)}</td><td>${pvalue(row.p_value)}</td><td>${pvalue(row.interaction_p)}</td></tr>`).join('')}</tbody></table><p><small>探索性结果，未进行多重性校正。</small></p>`:''}`}
function descriptiveMetric(value){return value==='weighted_mean'?'加权均值':value==='weighted_prevalence'?'加权患病率':'加权构成比';}
function mdCell(value){return String(value??'').replaceAll('|','\\|').replace(/[\r\n]+/g,' ');}
function genericMarkdownReport(project,result){const main=(result.coefficients||[]).find(item=>item.term==='analysis_exposure'),spec=project.modelSpec||{},flow=result.flow||{},sensitivity=result.sensitivityCoefficients||[],weights=result.weightDiagnostics||{},design=result.designDiagnostics||{},domain=result.domainDiagnostics||{},missing=result.missingnessDiagnostics||[],completeCases=result.completeCaseDiagnostics||{},model=result.modelDiagnostics||{},descriptives=result.descriptiveStatistics||[],interpretation=buildInterpretation(project,result);return `# ${project.title||'NHANES 流行病学研究报告'}

> 状态：复杂抽样加权分析已完成并通过自动质量门。本报告解释统计证据与不确定性，仅支持关联性结论。

## 结果摘要

${interpretation.main}

${interpretation.conclusion}

## 研究问题

${project.question}

## 数据与方法

- NHANES 周期：${(project.intent?.cycles||[]).join('、')}
- 暴露变量：${(spec.exposureMappings||[]).map(x=>`${x.cycles?.[0]} ${x.variable}`).join('；')}
- 结局变量：${(spec.outcomeMappings||[]).map(x=>`${x.cycles?.[0]} ${x.variable}`).join('；')}
- 结局类型：${spec.outcomeFamily}；结局转换：${spec.outcomeTransform}
- 暴露转换：${spec.exposureTransform}
- 复杂抽样：${spec.psuVariable}、${spec.strataVariable}；权重 ${result.weightRule}
- 协变量：${genericCovariates(spec)}
- 缺失数据：主分析采用完整案例；${spec.missingDataPolicy?.strategy==='multiple_imputation'?'协变量多重插补作为预设敏感性分析（不插补暴露或结局）':'未执行多重插补'}

## 加权描述性统计 Table 1

表中连续变量报告加权均值，二分类结局报告加权患病率，分类变量报告加权构成比；未加权 n 用于反映实际样本支持度。

| 变量 | 水平 | 指标 | 未加权 n | 加权估计 | 95% CI |
|---|---|---|---:|---:|---:|
${descriptives.map(item=>`| ${mdCell(descriptiveLabel(spec,item.variable))} | ${mdCell(item.level||'—')} | ${descriptiveMetric(item.metric)} | ${item.unweighted_n} | ${number(item.estimate)} | ${number(item.ci_low)}–${number(item.ci_high)} |`).join('\n')||'| 未记录 | — | — | — | — | — |'}

## 样本纳入流程

| 阶段 | n |
|---|---:|
| 合并后记录 | ${flow.merged} |
| 符合目标年龄 | ${flow.population_eligible} |
| 最终完整案例 | ${flow.analytic_complete_case} |

最终样本占符合目标人群者的 ${completeCases.retention==null?'未记录':number(100*Number(completeCases.retention),1)+'%'}；各阶段人数用于识别选择过程和潜在外推限制。

## 主要模型结果

主暴露效应=${number(effect(main))}（95% CI ${number(main?.ci_low)}–${number(main?.ci_high)}，P=${pvalue(main?.p_value)}；效应尺度：${main?.effect_type||'未记录'}）。

${interpretation.main}

## 敏感性分析

| 模型 | 效应 | 95% CI | P |
|---|---:|---:|---:|
${sensitivity.map(item=>`| ${mdCell(item.model)} | ${number(effect(item))} | ${number(item.ci_low)}–${number(item.ci_high)} | ${pvalue(item.p_value)} |`).join('\n')||'| 未执行 | — | — | — |'}

${interpretation.sensitivity}

${advancedMarkdown(result)}${result.nonlinearAnalysis?.method==='restricted_cubic_spline'?`${interpretation.nonlinear}\n\n`:''}${(result.subgroupAnalyses||[]).length?`${interpretation.subgroup}\n\n`:''}## 抽样设计与模型诊断

- 设计自由度：${design.degreesFreedom ?? '未记录'}；分层：${design.strata ?? '未记录'}；PSU：${design.psu ?? '未记录'}
- 子总体方差：${domain.method==='survey_subset'?'先定义完整抽样设计，再以 survey subset 进入分析域':'历史结果未记录'}；设计源样本：${domain.fullDesignN ?? '未记录'}；分析域样本：${domain.analyticDomainN ?? '未记录'}
- 权重中位数：${weights.median==null?'未记录':number(weights.median)}；第1–99百分位：${weights.p01==null?'未记录':number(weights.p01)}–${weights.p99==null?'未记录':number(weights.p99)}；截尾观测：${weights.trimmed ?? '未记录'}
- 模型收敛：${model.converged===true?'是':model.converged===false?'否':'未记录'}；秩/参数：${model.rank ?? '—'} / ${model.parameters ?? '—'}；残差自由度：${model.residualDf ?? '—'}；条件数：${model.conditionNumber==null?'未记录':number(model.conditionNumber,1)}

${interpretation.diagnostics}

## 缺失数据

- 完整案例保留率：${completeCases.retention==null?'未记录':number(100*Number(completeCases.retention),1)+'%'}（${completeCases.completeN ?? '—'} / ${completeCases.populationN ?? '—'}）

| 变量 | 缺失 n | 缺失率 |
|---|---:|---:|
${missing.map(item=>`| ${mdCell(item.variable)} | ${item.missing_n} | ${number(item.missing_pct,1)}% |`).join('\n')||'| 未记录 | — | — |'}

${interpretation.missingness}

${result.imputationDiagnostics?.requested?`### 多重插补敏感性分析

${interpretation.imputation}
`:''}

## 流行病学结论

${interpretation.conclusion}

统计学显著性不等同于临床或公共卫生重要性；效应大小、置信区间、结局基线风险和既有证据需共同判断。

## 局限性

- 横断面设计不能确定时间先后，存在反向因果可能。
- 观察性研究不能排除未测量或残余混杂，不能表述为因果效应。
- 完整案例分析可能产生选择偏倚；亚组分析和多次检验可能产生偶然阳性。
- NHANES 代表美国非机构化人群，外推到其他国家、住院人群或特殊临床人群需谨慎。
${(result.warnings||[]).map(item=>`- ${item}`).join('\n')}

## 复现与审计信息

- 模型配置 SHA-256：${result.modelSpecDigest}
- ${result.runtime?.rVersion}
- survey ${result.runtime?.surveyVersion}；haven ${result.runtime?.havenVersion}
- 完成时间：${result.runtime?.completedAt}
`;}
function genericHtmlReport(project,result){
  const main=(result.coefficients||[]).find(item=>item.term==='analysis_exposure'),spec=project.modelSpec||{},flow=result.flow||{},sensitivity=result.sensitivityCoefficients||[],weights=result.weightDiagnostics||{},design=result.designDiagnostics||{},domain=result.domainDiagnostics||{},missing=result.missingnessDiagnostics||[],completeCases=result.completeCaseDiagnostics||{},model=result.modelDiagnostics||{},descriptives=result.descriptiveStatistics||[];
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(project.title)} · NHANES 报告</title><style>body{font:15px/1.65 Arial,"Microsoft YaHei",sans-serif;color:#17211d;max-width:980px;margin:36px auto;padding:0 24px}h1,h2{color:#174f3b}.notice{background:#fbf3e7;padding:12px;border:1px solid #edddc4}code{background:#edf3ee;padding:2px 4px}figure{overflow:auto}table{width:100%;border-collapse:collapse}th,td{padding:8px;border-bottom:1px solid #dfe3dc;text-align:left}th{background:#edf3ee}</style></head><body><h1>${esc(project.title)}</h1><p>${esc(project.question)}</p><p class="notice">通用 survey R 分析已完成并通过自动质量门；仅描述横断面关联，不支持因果推断。</p><h2>数据与方法</h2><ul><li>周期：${esc((project.intent?.cycles||[]).join('、'))}</li><li>暴露：${esc((spec.exposureMappings||[]).map(x=>`${x.cycles?.[0]} ${x.variable}`).join('；'))}；转换 ${esc(spec.exposureTransform)}</li><li>结局：${esc((spec.outcomeMappings||[]).map(x=>`${x.cycles?.[0]} ${x.variable}`).join('；'))}；${esc(spec.outcomeFamily)} / ${esc(spec.outcomeTransform)}</li><li>权重：${esc(result.weightRule)}</li><li>协变量：${esc(genericCovariates(spec))}</li></ul><h2>加权描述性统计（Table 1）</h2><table><thead><tr><th>变量</th><th>水平</th><th>指标</th><th>未加权 n</th><th>加权估计</th><th>95% CI</th></tr></thead><tbody>${descriptives.map(item=>`<tr><td>${esc(descriptiveLabel(spec,item.variable))}</td><td>${esc(item.level||'—')}</td><td>${descriptiveMetric(item.metric)}</td><td>${esc(item.unweighted_n)}</td><td>${number(item.estimate)}</td><td>${number(item.ci_low)}–${number(item.ci_high)}</td></tr>`).join('')||'<tr><td colspan="6">未记录</td></tr>'}</tbody></table><h2>样本流程</h2><figure>${flowSvg(result)}</figure><p>合并 ${esc(flow.merged)} 条记录，符合目标年龄 ${esc(flow.population_eligible)}，最终完整案例 ${esc(flow.analytic_complete_case)}。</p><h2>主要结果</h2><p>主暴露效应 <b>${number(effect(main))}</b>（95% CI ${number(main.ci_low)}–${number(main.ci_high)}，P=${pvalue(main.p_value)}；${esc(main.effect_type)}）。</p><figure>${forestSvg(result)}</figure><h2>敏感性分析</h2><table><thead><tr><th>模型</th><th>效应</th><th>95% CI</th><th>P</th></tr></thead><tbody>${sensitivity.map(item=>`<tr><td>${esc(item.model)}</td><td>${number(effect(item))}</td><td>${number(item.ci_low)}–${number(item.ci_high)}</td><td>${pvalue(item.p_value)}</td></tr>`).join('')||'<tr><td colspan="4">未执行</td></tr>'}</tbody></table><h2>抽样设计诊断</h2><ul><li>设计自由度 ${esc(design.degreesFreedom??'未记录')}；分层 ${esc(design.strata??'未记录')}；PSU ${esc(design.psu??'未记录')}</li><li>子总体方差：${domain.method==='survey_subset'?'先定义完整抽样设计，再进入分析域':'历史结果未记录'}；设计源样本 ${esc(domain.fullDesignN??'未记录')}；分析域样本 ${esc(domain.analyticDomainN??'未记录')}</li><li>权重中位数 ${esc(weights.median==null?'未记录':number(weights.median))}；第1–99百分位 ${esc(weights.p01==null?'未记录':number(weights.p01))}–${esc(weights.p99==null?'未记录':number(weights.p99))}；截尾观测 ${esc(weights.trimmed??'未记录')}</li></ul><h2>缺失数据与模型稳定性</h2><ul><li>完整案例保留率 ${esc(completeCases.retention==null?'未记录':number(100*Number(completeCases.retention),1)+'%')}（${esc(completeCases.completeN??'—')} / ${esc(completeCases.populationN??'—')}）</li><li>模型收敛 ${model.converged===true?'是':model.converged===false?'否':'未记录'}；秩/参数 ${esc(model.rank??'—')} / ${esc(model.parameters??'—')}；残差自由度 ${esc(model.residualDf??'—')}；条件数 ${esc(model.conditionNumber==null?'未记录':number(model.conditionNumber,1))}</li></ul><table><thead><tr><th>变量</th><th>缺失 n</th><th>缺失率</th></tr></thead><tbody>${missing.map(item=>`<tr><td>${esc(item.variable)}</td><td>${esc(item.missing_n)}</td><td>${number(item.missing_pct,1)}%</td></tr>`).join('')||'<tr><td colspan="3">未记录</td></tr>'}</tbody></table>${advancedHtml(result)}<h2>局限性</h2><ul>${(result.warnings||[]).map(x=>`<li>${esc(x)}</li>`).join('')}</ul><h2>复现信息</h2><p>模型配置 <code>${esc(result.modelSpecDigest)}</code><br>${esc(result.runtime?.rVersion)}；survey ${esc(result.runtime?.surveyVersion)}；haven ${esc(result.runtime?.havenVersion)}；${esc(result.runtime?.completedAt)}</p></body></html>`;
}
function publicationHtmlReport(project,result){
  const main=(result.coefficients||[]).find(item=>item.term==='analysis_exposure'),spec=project.modelSpec||{},flow=result.flow||{},sensitivity=result.sensitivityCoefficients||[],weights=result.weightDiagnostics||{},design=result.designDiagnostics||{},domain=result.domainDiagnostics||{},missing=result.missingnessDiagnostics||[],model=result.modelDiagnostics||{},descriptives=result.descriptiveStatistics||[],interpretation=buildInterpretation(project,result),subgroupChart=subgroupForestSvg(result),missingChart=missingnessSvg(result);
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(project.title)} · NHANES 报告</title><style>:root{--ink:#17211d;--green:#174f3b;--green2:#2a7f62;--cream:#f6f3ea;--line:#d9e1dc;--orange:#c77d2a}*{box-sizing:border-box}body{font:15px/1.72 Arial,"Microsoft YaHei",sans-serif;color:var(--ink);max-width:1040px;margin:0 auto;padding:44px 44px 72px;background:#fff}header{padding:24px 0 28px;border-bottom:3px solid var(--green)}h1{font-size:34px;line-height:1.25;margin:0 0 12px;color:var(--ink)}h2{font-size:22px;margin:42px 0 14px;color:var(--green)}h3{font-size:17px;color:var(--ink)}.kicker{letter-spacing:.08em;color:var(--green2);font-weight:700}.lede{font-size:18px;max-width:820px}.notice{margin:24px 0;padding:16px 18px;background:var(--cream);border-left:5px solid var(--orange)}.summary{font-size:17px}.interpretation{border-left:3px solid var(--green2);padding-left:16px;margin:18px 0;color:#263a32}.caption{font-size:13px;color:#607067;margin-top:4px}code{background:#edf3ee;padding:2px 4px}figure{overflow:auto;margin:20px 0 28px}figure svg{max-width:100%;height:auto}table{width:100%;border-collapse:collapse;margin:14px 0 18px;font-size:14px}th,td{padding:10px 9px;border:1px solid var(--line);text-align:left;vertical-align:middle}th{background:var(--green);color:#fff}tbody tr:nth-child(even){background:#f7faf8}.conclusion{font-size:17px;font-weight:600}footer{margin-top:48px;padding-top:18px;border-top:1px solid var(--line);color:#607067;font-size:12px}@media(max-width:700px){body{padding:24px 18px}h1{font-size:27px}table{font-size:12px}}@media print{body{max-width:none;padding:20px}h2{break-after:avoid}table,figure{break-inside:avoid}.notice{background:#fff}}</style></head><body><header><div class="kicker">NHANES 流行病学分析报告</div><h1>${esc(project.title)}</h1><p class="lede">${esc(project.question)}</p></header><p class="notice">复杂抽样加权分析已完成并通过自动质量门。本报告解释统计证据及其不确定性，不将横断面关联表述为因果效应。</p><h2>结果摘要</h2><p class="summary">${esc(interpretation.main)}</p><p class="conclusion">${esc(interpretation.conclusion)}</p><h2>数据与方法</h2><ul><li>周期：${esc((project.intent?.cycles||[]).join('、'))}</li><li>暴露：${esc((spec.exposureMappings||[]).map(x=>`${x.cycles?.[0]} ${x.variable}`).join('；'))}；转换 ${esc(spec.exposureTransform)}</li><li>结局：${esc((spec.outcomeMappings||[]).map(x=>`${x.cycles?.[0]} ${x.variable}`).join('；'))}；${esc(spec.outcomeFamily)} / ${esc(spec.outcomeTransform)}</li><li>复杂抽样：${esc(spec.psuVariable)}、${esc(spec.strataVariable)}；权重 ${esc(result.weightRule)}</li><li>协变量：${esc(genericCovariates(spec))}</li></ul><h2>加权描述性统计 Table 1</h2><p>连续变量报告加权均值，分类变量报告加权构成比，二分类结局报告加权患病率。未加权 n 反映实际样本支持度。</p><table><thead><tr><th>变量</th><th>水平</th><th>指标</th><th>未加权 n</th><th>加权估计</th><th>95% CI</th></tr></thead><tbody>${descriptives.map(item=>`<tr><td>${esc(descriptiveLabel(spec,item.variable))}</td><td>${esc(item.level||'—')}</td><td>${descriptiveMetric(item.metric)}</td><td>${esc(item.unweighted_n)}</td><td>${number(item.estimate)}</td><td>${number(item.ci_low)}–${number(item.ci_high)}</td></tr>`).join('')||'<tr><td colspan="6">未记录</td></tr>'}</tbody></table><h2>样本纳入流程</h2><figure>${flowSvg(result)}<figcaption class="caption">图 1 研究对象筛选与最终分析样本</figcaption></figure><p>合并 ${esc(flow.merged)} 条记录，${esc(flow.population_eligible)} 人符合目标年龄，${esc(flow.analytic_complete_case)} 人进入完整案例分析。</p><h2>主要模型结果</h2><p><b>${number(effect(main))}</b>（95% CI ${number(main?.ci_low)}–${number(main?.ci_high)}，P=${pvalue(main?.p_value)}；${esc(main?.effect_type||'未记录')}）。</p><figure>${forestSvg(result)}<figcaption class="caption">图 2 主暴露效应与 95% 置信区间</figcaption></figure><p class="interpretation">${esc(interpretation.main)}</p><h2>敏感性分析</h2><table><thead><tr><th>模型</th><th>效应</th><th>95% CI</th><th>P</th></tr></thead><tbody>${sensitivity.map(item=>`<tr><td>${esc(item.model)}</td><td>${number(effect(item))}</td><td>${number(item.ci_low)}–${number(item.ci_high)}</td><td>${pvalue(item.p_value)}</td></tr>`).join('')||'<tr><td colspan="4">未执行</td></tr>'}</tbody></table><p class="interpretation">${esc(interpretation.sensitivity)}</p>${advancedHtml(result)}${result.nonlinearAnalysis?.method==='restricted_cubic_spline'?`<p class="interpretation">${esc(interpretation.nonlinear)}</p>`:''}${subgroupChart?`<figure>${subgroupChart}<figcaption class="caption">图 3 亚组效应森林图；交互检验用于判断异质性</figcaption></figure><p class="interpretation">${esc(interpretation.subgroup)}</p>`:''}<h2>抽样设计与模型诊断</h2><ul><li>设计自由度 ${esc(design.degreesFreedom??'未记录')}；分层 ${esc(design.strata??'未记录')}；PSU ${esc(design.psu??'未记录')}</li><li>子总体方差：${domain.method==='survey_subset'?'先定义完整抽样设计，再进入分析域':'历史结果未记录'}；设计源样本 ${esc(domain.fullDesignN??'未记录')}；分析域样本 ${esc(domain.analyticDomainN??'未记录')}</li><li>权重中位数 ${esc(weights.median==null?'未记录':number(weights.median))}；第1–99百分位 ${esc(weights.p01==null?'未记录':number(weights.p01))}–${esc(weights.p99==null?'未记录':number(weights.p99))}；截尾观测 ${esc(weights.trimmed??'未记录')}</li><li>模型收敛 ${model.converged===true?'是':model.converged===false?'否':'未记录'}；秩/参数 ${esc(model.rank??'—')} / ${esc(model.parameters??'—')}；残差自由度 ${esc(model.residualDf??'—')}；条件数 ${esc(model.conditionNumber==null?'未记录':number(model.conditionNumber,1))}</li></ul><p class="interpretation">${esc(interpretation.diagnostics)}</p><h2>缺失数据</h2>${missingChart?`<figure>${missingChart}<figcaption class="caption">图 ${subgroupChart?'4':'3'} 分析字段缺失率</figcaption></figure>`:''}<table><thead><tr><th>变量</th><th>缺失 n</th><th>缺失率</th></tr></thead><tbody>${missing.map(item=>`<tr><td>${esc(item.variable)}</td><td>${esc(item.missing_n)}</td><td>${number(item.missing_pct,1)}%</td></tr>`).join('')||'<tr><td colspan="3">未记录</td></tr>'}</tbody></table><p class="interpretation">${esc(interpretation.missingness)}</p><h2>流行病学结论</h2><p class="conclusion">${esc(interpretation.conclusion)}</p><p>统计学显著性不等同于临床或公共卫生重要性；应同时评估效应大小、置信区间、结局基线风险及既有研究证据。</p><h2>局限性</h2><ul><li>横断面设计不能确定时间先后，存在反向因果可能。</li><li>观察性研究不能排除未测量或残余混杂，不能表述为因果效应。</li><li>完整案例分析可能产生选择偏倚；亚组分析和多次检验可能产生偶然阳性。</li><li>NHANES 代表美国非机构化人群，外推至其他人群需谨慎。</li>${(result.warnings||[]).map(x=>`<li>${esc(x)}</li>`).join('')}</ul><h2>复现与审计信息</h2><p>模型配置 <code>${esc(result.modelSpecDigest)}</code><br>${esc(result.runtime?.rVersion)}；survey ${esc(result.runtime?.surveyVersion)}；haven ${esc(result.runtime?.havenVersion)}；${esc(result.runtime?.completedAt)}</p><footer>NHANES Research Agent · 自动生成后仍需研究者审核变量定义、模型假设和临床语境</footer></body></html>`;
}
function markdownReport(project, result) { if(isGeneric(result))return genericMarkdownReport(project,result);const main = exposureRow(result), sensitivity = sensitivityRows(result), flow = result.flow || {}, decisions = approvalDecisions(project), interpretation = buildInterpretation(project,result); return `# ${project.title || 'NHANES 流行病学研究报告'}

> 状态：真实 R 分析已完成；本报告描述横断面关联，不支持因果推断。

## 结果摘要

${interpretation.main}

${interpretation.conclusion}

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

${interpretation.main}

## 敏感性分析

| 模型 | 项目 | 效应 | 95% CI | P |
|---|---|---:|---:|---:|
${sensitivity.map(item=>`| ${item.model} | ${item.term} | ${number(effect(item))} | ${number(item.ci_low)}–${number(item.ci_high)} | ${number(item.p_value,4)} |`).join('\n')}

${interpretation.sensitivity}

## 流行病学结论

${interpretation.conclusion}

统计学显著性不等同于临床或公共卫生重要性；应同时评估效应大小、置信区间、结局基线风险及既有研究证据。

## 局限性

- 横断面设计不能确定时间先后，存在反向因果可能。
- 观察性研究不能排除未测量或残余混杂，不能表述为因果效应。
- 完整案例分析可能产生选择偏倚；敏感性分析和多次检验可能产生偶然阳性。
- NHANES 代表美国非机构化人群，外推至其他人群需谨慎。
${(result.warnings || []).map(item=>`- ${item}`).join('\n')}

## 复现信息

- ${result.runtime?.rVersion}
- survey ${result.runtime?.surveyVersion}；haven ${result.runtime?.havenVersion}
- 完成时间：${result.runtime?.completedAt}
`; }
function legacyPublicationHtmlReport(project, result) {
  const markdown = markdownReport(project,result), main=exposureRow(result), sensitivity=sensitivityRows(result), flow=result.flow||{}, decisions=approvalDecisions(project), interpretation=buildInterpretation(project,result);
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(project.title)} · NHANES 报告</title><style>:root{--ink:#17211d;--green:#174f3b;--green2:#2a7f62;--cream:#f6f3ea;--line:#d9e1dc;--orange:#c77d2a}*{box-sizing:border-box}body{font:15px/1.72 Arial,"Microsoft YaHei",sans-serif;color:var(--ink);max-width:1040px;margin:0 auto;padding:44px 44px 72px;background:#fff}header{padding:24px 0 28px;border-bottom:3px solid var(--green)}h1{font-size:34px;line-height:1.25;margin:0 0 12px}h2{font-size:22px;margin:42px 0 14px;color:var(--green)}.kicker{letter-spacing:.08em;color:var(--green2);font-weight:700}.lede{font-size:18px;max-width:820px}.notice{margin:24px 0;padding:16px 18px;background:var(--cream);border-left:5px solid var(--orange)}.summary,.conclusion{font-size:17px}.conclusion{font-weight:600}.interpretation{border-left:3px solid var(--green2);padding-left:16px;margin:18px 0;color:#263a32}.caption{font-size:13px;color:#607067;margin-top:4px}code{background:#edf3ee;padding:2px 4px}figure{overflow:auto;margin:20px 0 28px}figure svg{max-width:100%;height:auto}table{width:100%;border-collapse:collapse;margin:14px 0 18px;font-size:14px}th,td{padding:10px 9px;border:1px solid var(--line);text-align:left;vertical-align:middle}th{background:var(--green);color:#fff}tbody tr:nth-child(even){background:#f7faf8}footer{margin-top:48px;padding-top:18px;border-top:1px solid var(--line);color:#607067;font-size:12px}@media(max-width:700px){body{padding:24px 18px}h1{font-size:27px}table{font-size:12px}}@media print{body{max-width:none;padding:20px}h2{break-after:avoid}table,figure{break-inside:avoid}.notice{background:#fff}}</style></head><body><header><div class="kicker">NHANES 流行病学分析报告</div><h1>${esc(project.title)}</h1><p class="lede">${esc(project.question)}</p></header><p class="notice">复杂抽样加权 R 分析已完成并通过自动质量门。本报告解释统计证据及其不确定性，不将横断面关联表述为因果效应。</p><h2>结果摘要</h2><p class="summary">${esc(interpretation.main)}</p><p class="conclusion">${esc(interpretation.conclusion)}</p><h2>数据与方法</h2><ul><li>NHANES 周期：${esc((project.intent?.cycles||[]).join('、'))}</li><li>目标人群：美国 ${esc(project.intent?.population?.ageMin||20)} 岁以上成年人</li><li>暴露：血清总 25(OH)D（LBXVIDMS），每 10 nmol/L</li><li>结局：PHQ-9 总分 ≥10；连续 PHQ-9 为敏感性分析</li><li>复杂抽样：SDMVPSU、SDMVSTRA；${esc(result.weightRule)}</li><li>协变量：年龄、性别、种族/族裔、贫困收入比、BMI</li></ul><h2>研究者冻结决策</h2><ul>${Object.entries(decisions).map(([key,value])=>`<li><code>${esc(key)}</code>：${esc(value)}</li>`).join('')||'<li>此项目创建于方案冻结功能上线之前。</li>'}</ul><h2>样本流程</h2><figure>${flowSvg(result)}<figcaption class="caption">图 1 研究对象筛选与最终分析样本</figcaption></figure><p>合并 ${esc(flow.merged)} 条记录，最终完整案例 ${esc(flow.analytic_complete_case)} 人，其中抑郁病例 ${esc(flow.depression_cases)} 人。</p><h2>主要结果</h2><p>每升高 10 nmol/L，抑郁症状 OR <b>${number(effect(main))}</b>（95% CI ${number(main?.ci_low)}–${number(main?.ci_high)}，P=${pvalue(main?.p_value)}）。</p><figure>${forestSvg(result)}<figcaption class="caption">图 2 调整后比值比与 95% 置信区间</figcaption></figure><p class="interpretation">${esc(interpretation.main)}</p><h2>敏感性分析</h2><table><thead><tr><th>模型</th><th>项目</th><th>效应</th><th>95% CI</th><th>P</th></tr></thead><tbody>${sensitivity.map(item=>`<tr><td>${esc(item.model)}</td><td>${esc(item.term)}</td><td>${number(effect(item))}</td><td>${number(item.ci_low)}–${number(item.ci_high)}</td><td>${pvalue(item.p_value)}</td></tr>`).join('')||'<tr><td colspan="5">未执行或未记录</td></tr>'}</tbody></table><p class="interpretation">${esc(interpretation.sensitivity)}</p><h2>流行病学结论</h2><p class="conclusion">${esc(interpretation.conclusion)}</p><p>统计学显著性不等同于临床或公共卫生重要性；应同时评估效应大小、置信区间、结局基线风险及既有研究证据。</p><h2>局限性</h2><ul><li>横断面设计不能确定时间先后，存在反向因果可能。</li><li>观察性研究不能排除未测量或残余混杂，不能表述为因果效应。</li><li>完整案例分析可能产生选择偏倚；敏感性分析和多次检验可能产生偶然阳性。</li><li>NHANES 代表美国非机构化人群，外推至其他人群需谨慎。</li>${(result.warnings||[]).map(item=>`<li>${esc(item)}</li>`).join('')}</ul><h2>复现与审计信息</h2><p>${esc(result.runtime?.rVersion)}；survey ${esc(result.runtime?.surveyVersion)}；haven ${esc(result.runtime?.havenVersion)}；${esc(result.runtime?.completedAt)}</p><footer>NHANES Research Agent · 自动生成后仍需研究者审核变量定义、模型假设和临床语境</footer><!-- markdown-bytes:${Buffer.byteLength(markdown)} --></body></html>`;
}
function addImputationHtml(html,result){if(!result.imputationDiagnostics?.requested)return html;const interpretation=buildInterpretation({},result);const block=`<h2>多重插补敏感性分析</h2><p class="interpretation">${esc(interpretation.imputation)}</p>`;return html.replace('<h2>流行病学结论</h2>',`${block}<h2>流行病学结论</h2>`)}
function htmlReport(project, result) { return isGeneric(result)?addImputationHtml(publicationHtmlReport(project,result),result):legacyPublicationHtmlReport(project,result); }

function finiteValue(value){return value!==null&&value!==''&&Number.isFinite(Number(value))}
function primaryEstimate(result){return isGeneric(result)?(result.coefficients||[]).find(item=>item.term==='analysis_exposure'):exposureRow(result)}
function ratioEstimate(row,result){return ['odds_ratio','rate_ratio','risk_ratio'].includes(row?.effect_type)||(!isGeneric(result)&&row?.term==='I(LBXVIDMS/10)'&&row?.model!=='continuous_phq9')}
function evidenceSupported(row,result){if(!row||![effect(row),row.ci_low,row.ci_high,row.p_value].every(finiteValue))return false;const nullValue=ratioEstimate(row,result)?1:0;return Number(row.p_value)<.05&&(Number(row.ci_high)<nullValue||Number(row.ci_low)>nullValue)}
function displayValue(value,digits=3){return finiteValue(value)?Number(value).toFixed(digits):'未记录'}
function displayP(value){return !finiteValue(value)?'未记录':Number(value)<.001?'<0.001':Number(value).toFixed(3)}
function reportLabels(project,result){const spec=project.modelSpec||{},legacy=!isGeneric(result);return {exposure:project.intent?.exposure?.label||project.intent?.exposure?.concept||(legacy?'血清总 25(OH)D':(spec.exposureMappings||[]).map(item=>item.variable).filter(Boolean).join('/')||'主要暴露'),outcome:project.intent?.outcome?.label||project.intent?.outcome?.concept||(legacy?'抑郁症状筛查阳性':(spec.outcomeMappings||[]).map(item=>item.variable).filter(Boolean).join('/')||'研究结局'),population:`美国 ${project.intent?.population?.ageMin||20} 岁以上目标人群`,cycles:(project.intent?.cycles||[]).join('、')||'未记录'} }
function methodRows(project,result){const spec=project.modelSpec||{},labels=reportLabels(project,result),legacy=!isGeneric(result),imputation=spec.missingDataPolicy?.strategy==='multiple_imputation';return [
  ['数据来源',`NHANES ${labels.cycles}`,'全国代表性复杂抽样调查；分析必须使用权重、分层和 PSU'],
  ['研究对象',labels.population,'报告中的估计面向符合纳入条件的美国非机构化人群'],
  ['暴露',legacy?'LBXVIDMS；每 10 nmol/L':`${labels.exposure}；${spec.exposureTransform||'原值'}`,'效应值对应这里冻结的暴露单位，改变单位会改变系数大小'],
  ['结局',legacy?'PHQ-9≥10；连续得分为敏感性分析':`${labels.outcome}；${spec.outcomeFamily||'未记录'} / ${spec.outcomeTransform||'未记录'}`,'结局定义决定模型类型和无效值，不能在看完结果后随意更改'],
  ['复杂抽样',`${spec.psuVariable||'SDMVPSU'}、${spec.strataVariable||'SDMVSTRA'}；${result.weightRule||spec.weightVariable||'权重未记录'}`,'用于获得全国推断及设计一致的标准误、置信区间和 P 值'],
  ['协变量',legacy?'年龄、性别、种族/族裔、贫困收入比、BMI':genericCovariates(spec),'用于控制预设混杂因素；仍不能排除未测量或残余混杂'],
  ['缺失数据',imputation?'完整案例主分析；协变量多重插补敏感性分析':'完整案例主分析','暴露和结局不自动插补；样本损失和缺失机制必须单独解释']
]}
function mainEffectGuide(project,result){const row=primaryEstimate(result),labels=reportLabels(project,result);if(!row||![effect(row),row.ci_low,row.ci_high].every(finiteValue))return ['主要效应数据不完整，不能逐项解释。','置信区间和 P 值不可用时，不应形成方向性结论。','统计结果必须与变量定义、样本流程和模型诊断一起审核。'];const estimate=Number(effect(row)),ratio=ratioEstimate(row,result),nullValue=ratio?1:0,crosses=Number(row.ci_low)<=nullValue&&Number(row.ci_high)>=nullValue,supported=evidenceSupported(row,result),scale=ratio?(row.effect_type==='rate_ratio'?'RR':'OR'):'β',magnitude=ratio?`${labels.exposure}每增加一个冻结单位，${labels.outcome}的${row.effect_type==='rate_ratio'?'发生率':'优势（odds）'}估计${estimate>=1?'升高':'降低'}约 ${Math.abs((estimate-1)*100).toFixed(1)}%`:`${labels.exposure}每增加一个冻结单位，${labels.outcome}的加权均值估计${estimate>=0?'升高':'降低'} ${Math.abs(estimate).toFixed(3)} 个单位`;return [
  `${scale}=${displayValue(estimate)}：${magnitude}。${scale==='OR'?'OR 描述优势比，不应直接写成绝对风险变化。':''}`,
  `95% CI ${displayValue(row.ci_low)}–${displayValue(row.ci_high)}：${crosses?'区间跨越无效值，数据仍兼容“无关联”':'区间未跨越无效值，但精确度仍应结合区间宽度判断'}。`,
  `P=${displayP(row.p_value)}：${supported?'达到预设统计学证据标准':'未达到预设统计学证据标准；不能把“未显著”解释成“已经证明没有关联”'}。`,
  '统计学显著不等于临床或公共卫生意义重大；还需结合效应大小、基线风险、测量误差和既有研究证据。'
]}
function evidenceBalance(project,result){const row=primaryEstimate(result),sensitivity=(result.sensitivityCoefficients||[]).filter(item=>finiteValue(effect(item))),supported=evidenceSupported(row,result),nullValue=ratioEstimate(row,result)?1:0,mainDirection=finiteValue(effect(row))?Number(effect(row))>=nullValue:null,sameDirection=mainDirection===null?0:sensitivity.filter(item=>(Number(effect(item))>=(ratioEstimate(item,result)?1:0))===mainDirection).length,retention=Number(result.completeCaseDiagnostics?.retention),screened=project.evidence?.summary,quality=result.qualitySummary,qualityTotal=quality?.total??quality?.passed;const signal=[supported?'主模型置信区间未跨越无效值并达到预设统计学证据标准':'主模型提供了方向性估计，但未达到确认关联的预设标准',sensitivity.length?`${sameDirection}/${sensitivity.length} 个敏感性估计与主模型方向一致`:'未记录可比较的敏感性估计'];const limits=['横断面设计不能确定时间先后，存在反向因果可能','观察性研究不能排除未测量或残余混杂',Number.isFinite(retention)&&retention<.8?`完整案例保留率仅 ${(retention*100).toFixed(1)}%，选择偏倚风险较高`:'完整案例分析仍依赖缺失机制假设'];const context=['使用 NHANES 复杂抽样权重、分层和 PSU 进行全国推断',quality?`自动质量门：通过 ${quality.passed}/${qualityTotal} 项，警告 ${quality.warnings||0} 项`:'分析结果已通过必需质量门',screened?`文献人工筛选：纳入 ${screened.included||0} 篇、待定 ${screened.uncertain||0} 篇`:'文献证据需结合已筛选的 PubMed 结果单独判断'];const grade=supported?(sensitivity.length&&sameDirection>=Math.ceil(sensitivity.length/2)?'存在统计学关联信号且多数敏感性结果方向一致；证据仍限于观察性横断面关联。':'主模型存在统计学关联信号，但稳健性和外部证据仍需审查。'):'目前属于提示性或不确定证据，不能确认存在关联，也不能证明没有关联。';return {signal,limits,context,grade}}
function listHtml(items){return `<ul>${items.map(item=>`<li>${esc(item)}</li>`).join('')}</ul>`}
function enhancementCss(){return `.keybox{background:#eef5ea;border-left:4px solid var(--green,#174f3b);padding:14px 18px;border-radius:0 7px 7px 0;margin:18px 0}.keybox ul{margin:7px 0}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:18px 0}.stat{background:#fff;border:1px solid var(--line,#dfe3dc);border-radius:9px;padding:14px;text-align:center;box-shadow:0 2px 8px rgba(23,79,59,.06)}.stat .num{font-family:Georgia,"Microsoft YaHei",serif;font-size:21px;color:var(--green,#174f3b);font-weight:700}.stat .lab{font-size:12px;color:#607067}.term{background:#eef5ea;border:1px solid var(--line,#dfe3dc);border-radius:7px;padding:12px 15px;margin:14px 0}.term b{color:var(--green,#174f3b)}.evidence-table td{width:33.333%;vertical-align:top}.evidence-table ul{padding-left:18px;margin:0}.faq{padding:12px 0;border-bottom:1px solid var(--line,#dfe3dc)}.faq b{color:var(--green,#174f3b)}@media(max-width:760px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.evidence-table,.evidence-table tbody,.evidence-table tr,.evidence-table td{display:block;width:100%}}@media print{.stat{box-shadow:none}.keybox,.term{background:#fff}}`}
function enhancedHtmlSections(project,result){const row=primaryEstimate(result),labels=reportLabels(project,result),flow=result.flow||{},interpretation=buildInterpretation(project,result),balance=evidenceBalance(project,result),methods=methodRows(project,result),cycles=(project.intent?.cycles||[]).length,finalN=flow.analytic_complete_case??result.completeCaseDiagnostics?.completeN,quality=result.qualitySummary,qualityTotal=quality?.total??quality?.passed,scale=ratioEstimate(row,result)?(row?.effect_type==='rate_ratio'?'RR':'OR'):'β';const intro=`<h2>30 秒看懂这项研究</h2><div class="keybox"><ul><li><b>研究问题：</b>${esc(project.question||`${labels.exposure}与${labels.outcome}是否相关？`)}</li><li><b>研究对象：</b>${esc(labels.population)}，最终分析 ${esc(finalN??'未记录')} 人。</li><li><b>核心结果：</b>${esc(interpretation.main)}</li><li><b>一句话结论：</b>${esc(interpretation.conclusion)}</li></ul></div><div class="grid"><div class="stat"><div class="num">${esc(finalN??'—')}</div><div class="lab">最终分析人数</div></div><div class="stat"><div class="num">${esc(cycles||'—')}</div><div class="lab">NHANES 周期数</div></div><div class="stat"><div class="num">${esc(row?`${scale} ${displayValue(effect(row))}`:'—')}</div><div class="lab">主暴露效应</div></div><div class="stat"><div class="num">${esc(row?`P ${displayP(row.p_value)}`:'—')}</div><div class="lab">统计学证据${quality?` · QC ${esc(quality.passed)}/${esc(qualityTotal)}`:''}</div></div></div>`;const method=`<h2>研究是怎么做的（通俗版）</h2><table><thead><tr><th>要素</th><th>冻结方案</th><th>为什么重要</th></tr></thead><tbody>${methods.map(item=>`<tr><td><b>${esc(item[0])}</b></td><td>${esc(item[1])}</td><td>${esc(item[2])}</td></tr>`).join('')}</tbody></table><div class="term"><b>什么是冻结方案？</b> 在查看研究结果前锁定暴露、结局、协变量、权重和缺失数据处理，减少根据结果反复挑选模型造成的偏倚。配置摘要和运行环境记录在报告末尾。</div>`;const guide=`<h2>主结果怎么读</h2><div class="term">${mainEffectGuide(project,result).map((item,index)=>`${index+1}. ${esc(item)}`).join('<br>')}</div>`;const evidence=`<h2>这份证据到底有多强？</h2><table class="evidence-table"><thead><tr><th>关联信号</th><th>制约结论的因素</th><th>方法与证据背景</th></tr></thead><tbody><tr><td>${listHtml(balance.signal)}</td><td>${listHtml(balance.limits)}</td><td>${listHtml(balance.context)}</td></tr></tbody></table><p class="term"><b>综合判断：</b>${esc(balance.grade)}</p>`;const faq=`<h2>常见问题</h2><div class="faq"><b>Q1：这个结果能证明${esc(labels.exposure)}导致${esc(labels.outcome)}吗？</b><br>不能。NHANES 横断面分析只能描述同一时期的关联，不能确定时间先后或排除反向因果。</div><div class="faq"><b>Q2：P 值没有达到 0.05，是否说明完全没有关联？</b><br>不是。正确含义是当前数据不足以排除无效值；应结合置信区间判断仍与哪些效应大小相容。</div><div class="faq"><b>Q3：结果显著时能否直接提出治疗或补充建议？</b><br>不能。观察性关联还需要临床意义评估、前瞻性研究和干预证据，不能直接转化为个体诊疗建议。</div><div class="faq"><b>Q4：为什么还要做敏感性、亚组或多重插补？</b><br>这些分析用于检查结论是否依赖某一种模型或缺失处理；方向一致能增加稳健性，但不能消除混杂和选择偏倚。</div>`;return {intro,method,guide,evidence,faq}}
function enhancePublicationHtml(html,project,result){const sections=enhancedHtmlSections(project,result);let value=html.replace('</style>',`${enhancementCss()}</style>`).replace('<h2>结果摘要</h2>',`${sections.intro}<h2>研究问题与结果摘要</h2>`);const methodMarker=value.includes('<h2>加权描述性统计')?'<h2>加权描述性统计':value.includes('<h2>研究者冻结决策')?'<h2>研究者冻结决策':'<h2>样本流程';value=value.replace(methodMarker,`${sections.method}${methodMarker}`);value=value.replace('<h2>敏感性分析</h2>',`${sections.guide}<h2>敏感性分析</h2>`);value=value.replace('<h2>流行病学结论</h2>',`${sections.evidence}<h2>流行病学结论</h2>`);value=value.replace('<h2>局限性</h2>',`${sections.faq}<h2>局限性</h2>`);return value}
function markdownEnhancements(project,result){const row=primaryEstimate(result),labels=reportLabels(project,result),flow=result.flow||{},interpretation=buildInterpretation(project,result),balance=evidenceBalance(project,result),methods=methodRows(project,result),cycles=(project.intent?.cycles||[]).length,finalN=flow.analytic_complete_case??result.completeCaseDiagnostics?.completeN,scale=ratioEstimate(row,result)?(row?.effect_type==='rate_ratio'?'RR':'OR'):'β';return {intro:`## 30 秒看懂这项研究

- **研究问题：** ${project.question||`${labels.exposure}与${labels.outcome}是否相关？`}
- **研究对象：** ${labels.population}，最终分析 ${finalN??'未记录'} 人。
- **核心结果：** ${interpretation.main}
- **一句话结论：** ${interpretation.conclusion}

| 最终样本 | NHANES 周期 | 主效应 | P 值 |
|---:|---:|---:|---:|
| ${finalN??'—'} | ${cycles||'—'} | ${row?`${scale} ${displayValue(effect(row))}`:'—'} | ${row?displayP(row.p_value):'—'} |

`,method:`## 研究方法（通俗版）

| 要素 | 冻结方案 | 为什么重要 |
|---|---|---|
${methods.map(item=>`| ${mdCell(item[0])} | ${mdCell(item[1])} | ${mdCell(item[2])} |`).join('\n')}

> 冻结方案是在查看研究结果前锁定暴露、结局、协变量、权重和缺失数据处理，用于减少根据结果反复挑选模型造成的偏倚。

`,guide:`## 主结果怎么读

${mainEffectGuide(project,result).map((item,index)=>`${index+1}. ${item}`).join('\n')}

`,evidence:`## 证据强度与平衡判断

| 关联信号 | 制约结论的因素 | 方法与证据背景 |
|---|---|---|
| ${mdCell(balance.signal.join('；'))} | ${mdCell(balance.limits.join('；'))} | ${mdCell(balance.context.join('；'))} |

**综合判断：** ${balance.grade}

`,faq:`## 常见问题

### 这个结果能证明因果关系吗？

不能。NHANES 横断面分析只能描述关联，不能确定时间先后或排除反向因果。

### P≥0.05 是否说明完全没有关联？

不是。它表示当前数据不足以排除无效值；应结合置信区间判断仍与哪些效应大小相容。

### 统计学显著能否直接转化为治疗建议？

不能。还需要评估效应大小、临床意义、前瞻性研究和干预证据。

### 敏感性分析有什么用？

用于判断结果是否依赖某一种模型或缺失数据处理。结果一致能增加稳健性，但不能消除混杂和选择偏倚。

`}}
function enhanceMarkdownReport(markdown,project,result){const sections=markdownEnhancements(project,result);let value=markdown.replace('## 结果摘要',`${sections.intro}## 研究问题与结果摘要`);const methodMarker=value.includes('## 加权描述性统计')?'## 加权描述性统计':value.includes('## 研究者冻结决策')?'## 研究者冻结决策':'## 样本流程';value=value.replace(methodMarker,`${sections.method}${methodMarker}`);value=value.replace('## 敏感性分析',`${sections.guide}## 敏感性分析`);value=value.replace('## 流行病学结论',`${sections.evidence}## 流行病学结论`);value=value.replace('## 局限性',`${sections.faq}## 局限性`);return value}
function publicationMarkdownReport(project,result){return enhanceMarkdownReport(markdownReport(project,result),project,result)}
function enhancedHtmlReport(project,result){return enhancePublicationHtml(htmlReport(project,result),project,result)}

module.exports = { exposureRow, sensitivityRows, flowSvg, forestSvg, missingnessSvg, subgroupForestSvg, markdownReport: publicationMarkdownReport, htmlReport: enhancedHtmlReport };
