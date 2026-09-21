const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  ImageRun,
  PageNumber,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} = require('docx');
const { markdownReport, flowSvg, forestSvg, missingnessSvg, subgroupForestSvg } = require('./report');

const FONT_FAMILY = 'Noto Sans SC';
const CSV_COLUMNS = ['section', 'model', 'term', 'label', 'effect_type', 'estimate', 'ci_low', 'ci_high', 'p_value', 'unweighted_n', 'metric', 'level', 'subgroup', 'interaction_p'];
const TRANSPARENT_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XQv3AAAAAElFTkSuQmCC', 'base64');

function numeric(value, digits = 3) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '未记录';
}

function pvalue(value) {
  if (!Number.isFinite(Number(value))) return '未记录';
  return Number(value) < 0.001 ? '<0.001' : numeric(value, 3);
}

function effect(row) {
  return row?.effect ?? row?.odds_ratio;
}

function isGeneric(result) {
  return String(result?.analysisMode || '').startsWith('generic_survey_v');
}

function modelLabel(family) {
  return family === 'binary' ? '复杂抽样加权 quasibinomial Logistic 回归' : family === 'count' ? '复杂抽样加权 quasipoisson 回归' : '复杂抽样加权线性回归';
}

function effectSentence(row) {
  if (!row) return '主要暴露效应未记录。';
  const scale = row.effect_type === 'odds_ratio' ? 'OR' : row.effect_type === 'rate_ratio' ? 'RR' : 'β';
  return `主要暴露效应为 ${scale}=${numeric(effect(row))}（95% CI ${numeric(row.ci_low)}–${numeric(row.ci_high)}，P=${pvalue(row.p_value)}）。`;
}

function manuscriptDraft(project, result) {
  const spec = project.modelSpec || {};
  const flow = result.flow || {};
  const main = isGeneric(result)
    ? (result.coefficients || []).find(row => row.term === 'analysis_exposure')
    : (result.coefficients || []).find(row => row.term === 'I(LBXVIDMS/10)');
  const cycles = (project.intent?.cycles || []).join('、') || '未记录';
  const ageMin = project.intent?.population?.ageMin ?? 18;
  const covariates = isGeneric(result)
    ? (spec.covariates || []).map(item => item.concept).join('、') || '未调整'
    : '年龄、性别、种族/族裔、贫困收入比和体质指数';
  const exposure = isGeneric(result)
    ? (spec.exposureMappings || []).map(item => `${item.cycles?.[0]}：${item.variable}`).join('；')
    : '血清总 25(OH)D（LBXVIDMS）';
  const outcome = isGeneric(result)
    ? (spec.outcomeMappings || []).map(item => `${item.cycles?.[0]}：${item.variable}`).join('；')
    : 'PHQ-9 总分≥10';
  const regression = isGeneric(result) ? modelLabel(spec.outcomeFamily) : '复杂抽样加权 quasibinomial Logistic 回归';
  const completeN = flow.analytic_complete_case ?? result.completeCaseDiagnostics?.completeN ?? '未记录';
  const populationN = flow.population_eligible ?? result.completeCaseDiagnostics?.populationN ?? '未记录';
  const sensitivity = (result.sensitivityCoefficients || []).length
    ? `敏感性分析包括 ${(result.sensitivityCoefficients || []).map(item => item.model).filter(Boolean).filter((value, index, values) => values.indexOf(value) === index).join('、')}。`
    : '未记录额外敏感性分析。';
  const nonlinear=result.nonlinearAnalysis?.method==='restricted_cubic_spline'?`预设限制性立方样条（df=${result.nonlinearAnalysis.df}）比较线性与非线性模型，survey Wald P=${pvalue(result.nonlinearAnalysis.p_value)}。`:'未预设非线性模型。';
  const subgroupRows=Array.isArray(result.subgroupAnalyses)?result.subgroupAnalyses:[],subgroupText=subgroupRows.length?`完成 ${new Set(subgroupRows.map(row=>row.subgroup)).size} 个预设亚组变量、${subgroupRows.length} 个分层估计；交互 P 值为探索性且未进行多重性校正。`:'未产生亚组估计。';
  return `# 论文 Methods / Results 草稿

> 本文本由已冻结方案和通过质量门的分析结果自动生成，投稿前必须由研究者核对期刊格式、变量定义、文献引用与临床解释。

## Methods

本研究采用 NHANES ${cycles} 周期数据开展横断面分析。研究对象限定为 ${ageMin} 岁及以上人群。暴露变量为 ${exposure}，结局变量为 ${outcome}。所有分析均考虑 NHANES 复杂抽样设计，使用分层变量 ${spec.strataVariable || 'SDMVSTRA'}、整群变量 ${spec.psuVariable || 'SDMVPSU'} 和分析权重 ${result.weightRule || spec.weightVariable || '未记录'}。多周期权重按照预先冻结的方案进行合并。

主模型采用${regression}，调整变量包括${covariates}。缺失数据主分析采用${spec.missingDataPolicy?.strategy === 'complete_case' || !spec.missingDataPolicy?.strategy ? '完整案例分析' : spec.missingDataPolicy.strategy}。分析先在完整 NHANES 抽样设计中定义权重、分层和 PSU，再通过 survey 子总体方法限制目标分析域，以保持方差估计的设计一致性。${sensitivity}${nonlinear}${subgroupText}

## Results

数据合并后共有 ${flow.merged ?? '未记录'} 条记录，其中 ${populationN} 人符合目标人群条件，${completeN} 人进入最终分析。${effectSentence(main)}

加权描述性统计、主模型、敏感性分析、缺失模式和抽样设计诊断见随附结果表。${nonlinear}${subgroupText}自动质量控制共通过 ${result.qualitySummary?.passed ?? '全部必需'} 项必需检查。结果仅表示横断面关联，不能据此推断因果关系。

`;
}

function csvCell(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

function resultTablesCsv(project, result) {
  const rows = [];
  for (const row of result.coefficients || []) rows.push({ section: 'main_model', model: row.model || 'primary', term: row.term, label: row.term, effect_type: row.effect_type, estimate: effect(row), ci_low: row.ci_low, ci_high: row.ci_high, p_value: row.p_value });
  for (const row of result.sensitivityCoefficients || []) rows.push({ section: 'sensitivity', model: row.model, term: row.term, label: row.term, effect_type: row.effect_type, estimate: effect(row), ci_low: row.ci_low, ci_high: row.ci_high, p_value: row.p_value });
  for (const row of result.descriptiveStatistics || []) rows.push({ section: 'table_1', model: '', term: row.variable, label: row.variable, estimate: row.estimate, ci_low: row.ci_low, ci_high: row.ci_high, unweighted_n: row.unweighted_n, metric: row.metric, level: row.level });
  for (const row of result.subgroupAnalyses || []) rows.push({ section: 'subgroup', model: row.model, term: row.term, label: row.term, effect_type: row.effect_type, estimate: effect(row), ci_low: row.ci_low, ci_high: row.ci_high, p_value: row.p_value, unweighted_n: row.unweighted_n, level: row.level, subgroup: row.subgroup, interaction_p: row.interaction_p });
  if(result.nonlinearAnalysis?.method==='restricted_cubic_spline')rows.push({section:'nonlinear',model:'restricted_cubic_spline',term:'analysis_exposure',label:`df=${result.nonlinearAnalysis.df}`,p_value:result.nonlinearAnalysis.p_value});
  for (const [label, value] of Object.entries(result.flow || {})) rows.push({ section: 'sample_flow', model: '', term: label, label, estimate: value });
  const metadata = [
    `# project_id=${project.id || ''}`,
    `# generated_at=${new Date().toISOString()}`,
    `# analysis_mode=${result.analysisMode || 'vitamin_d_phq9_v1'}`,
    `# model_spec_digest=${result.modelSpecDigest || ''}`,
  ];
  return `${metadata.join('\n')}\n${CSV_COLUMNS.join(',')}\n${rows.map(row => CSV_COLUMNS.map(column => csvCell(row[column])).join(',')).join('\n')}\n`;
}

function cleanMarkdown(value) {
  return String(value).replaceAll('&lt;', '<').replaceAll('&gt;', '>').replace(/\*\*/g, '').replace(/`/g, '').replace(/^>\s?/, '').trim();
}

function tableCells(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim().replaceAll('\\|', '|'));
}

function isDivider(line) {
  return /^\|?(?:\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?$/.test(line.trim());
}

function svgSize(svg, maximumWidth = 620, maximumHeight = 420) {
  const width = Number(/\bwidth="([0-9.]+)"/.exec(svg)?.[1] || 760);
  const height = Number(/\bheight="([0-9.]+)"/.exec(svg)?.[1] || 240);
  const scale = Math.min(maximumWidth / width, maximumHeight / height, 1);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

function docxFigure(svg, caption) {
  if (!svg) return [];
  const transformation = svgSize(svg);
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      keepNext: true,
      spacing: { before: 160, after: 80 },
      children: [new ImageRun({
        type: 'svg',
        data: Buffer.from(svg, 'utf8'),
        transformation,
        fallback: { type: 'png', data: TRANSPARENT_PNG, transformation },
      })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 180 },
      children: [new TextRun({ text: caption, italics: true, size: 18, color: '607067', font: FONT_FAMILY })],
    }),
  ];
}

function reportFigures(result) {
  const flow = docxFigure(flowSvg(result), '图 1 研究对象筛选与最终分析样本');
  const main = docxFigure(forestSvg(result), '图 2 主暴露效应与 95% 置信区间');
  const figures = new Map([['样本纳入流程', flow], ['样本流程', flow], ['主要模型结果', main], ['主要结果', main]]);
  const subgroup = subgroupForestSvg(result);
  const missing = missingnessSvg(result);
  if (subgroup) figures.set('高级分析', docxFigure(subgroup, '图 3 亚组效应与 95% 置信区间'));
  if (missing) figures.set('缺失数据', docxFigure(missing, `图 ${subgroup ? 4 : 3} 分析字段缺失率`));
  return figures;
}

function markdownToDocx(markdown, figures = new Map()) {
  const lines = String(markdown).replaceAll('\r', '').split('\n');
  const children = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }
    if (line.startsWith('|')) {
      const rawRows = [];
      while (index < lines.length && lines[index].trim().startsWith('|')) rawRows.push(lines[index++]);
      const rows = rawRows.filter(row => !isDivider(row)).map((row, rowIndex) => new TableRow({
        tableHeader: rowIndex === 0,
        children: tableCells(row).map(cell => new TableCell({
          margins: { top: 100, right: 120, bottom: 100, left: 120 },
          verticalAlign: VerticalAlign.CENTER,
          shading: rowIndex === 0 ? { fill: '1F4E78', color: 'auto', type: ShadingType.CLEAR } : undefined,
          children: [new Paragraph({ children: [new TextRun({ text: cleanMarkdown(cell), bold: rowIndex === 0, color: rowIndex === 0 ? 'FFFFFF' : '000000', font: FONT_FAMILY })] })],
        })),
      }));
      if (rows.length) children.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: { top: { style: BorderStyle.SINGLE, size: 4, color: 'D9D9D9' }, bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D9D9D9' }, left: { style: BorderStyle.SINGLE, size: 4, color: 'D9D9D9' }, right: { style: BorderStyle.SINGLE, size: 4, color: 'D9D9D9' }, insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'D9D9D9' }, insideVertical: { style: BorderStyle.SINGLE, size: 4, color: 'D9D9D9' } },
        rows,
      }));
      continue;
    }
    if (line.startsWith('# ')) children.push(new Paragraph({ text: cleanMarkdown(line.slice(2)), heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER }));
    else if (line.startsWith('## ')) {
      const heading = cleanMarkdown(line.slice(3));
      children.push(new Paragraph({ text: heading, heading: HeadingLevel.HEADING_1 }));
      if (figures.has(heading)) children.push(...figures.get(heading));
    }
    else if (line.startsWith('### ')) children.push(new Paragraph({ text: cleanMarkdown(line.slice(4)), heading: HeadingLevel.HEADING_2 }));
    else if (/^- /.test(line)) children.push(new Paragraph({ text: cleanMarkdown(line.slice(2)), bullet: { level: 0 } }));
    else children.push(new Paragraph({ children: [new TextRun({ text: cleanMarkdown(line), font: FONT_FAMILY })], spacing: { after: 140, line: 360 } }));
    index += 1;
  }
  return children;
}

async function createDocxReport(project, result) {
  const content = `${markdownReport(project, result)}\n\n${manuscriptDraft(project, result)}`;
  const document = new Document({
    creator: 'NHANES Research Agent',
    title: project.title || 'NHANES 流行病学研究报告',
    description: 'Quality-gated NHANES analysis report and manuscript draft',
    styles: {
      default: { document: { run: { font: FONT_FAMILY, size: 22, color: '000000' }, paragraph: { spacing: { line: 360, after: 140 } } } },
      paragraphStyles: [
        { id: 'Title', name: 'Title', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT_FAMILY, size: 38, bold: true, color: '000000' }, paragraph: { alignment: AlignmentType.CENTER, spacing: { before: 180, after: 320 } } },
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT_FAMILY, size: 30, bold: true, color: '000000' }, paragraph: { spacing: { before: 300, after: 160 }, keepNext: true } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT_FAMILY, size: 25, bold: true, color: '000000' }, paragraph: { spacing: { before: 240, after: 120 }, keepNext: true } },
      ],
    },
    sections: [{
      properties: { page: { margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } },
      children: markdownToDocx(content, reportFigures(result)),
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'NHANES Research Agent · ', font: FONT_FAMILY }), new TextRun({ children: [PageNumber.CURRENT], font: FONT_FAMILY })] })] }) },
    }],
  });
  return Packer.toBuffer(document);
}

function resolvePdfFont() {
  const configured = process.env.REPORT_FONT_PATH;
  const candidates = [
    configured && { file: path.resolve(configured), family: process.env.REPORT_FONT_FAMILY || undefined },
    { file: 'C:/Windows/Fonts/simhei.ttf' },
    { file: '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc', family: 'WenQuanYiZenHei' },
    { file: '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', family: 'NotoSansCJKsc-Regular' },
  ].filter(Boolean);
  const selected = candidates.find(candidate => fs.existsSync(candidate.file));
  if (!selected) { const error = new Error('Chinese PDF font is unavailable; configure REPORT_FONT_PATH'); error.code = 'REPORT_FONT_MISSING'; throw error; }
  return selected;
}

function pdfText(doc, text, options = {}) {
  const value = cleanMarkdown(text);
  if (!value) return doc.moveDown(options.gap || 0.35);
  const { x, y, ...textOptions } = options;
  doc.font('report-font');
  if (x === undefined && y === undefined) return doc.text(value, textOptions);
  const cursor = { x: doc.x, y: doc.y };
  doc.text(value, x ?? doc.x, y ?? doc.y, textOptions);
  doc.x = cursor.x;
  doc.y = cursor.y;
  return doc;
}

function ensurePdfSpace(doc, height) {
  const limit = doc.page.height - doc.page.margins.bottom - 42;
  if (doc.y + height > limit) doc.addPage();
}

function drawPdfFlow(doc, result) {
  const flow = result.flow || {};
  const rows = isGeneric(result)
    ? [['合并后记录', flow.merged], ['符合目标年龄', flow.population_eligible], ['最终完整案例', flow.analytic_complete_case]]
    : [['合并后记录', flow.merged], ['成年人', flow.adults], ['最终分析样本', flow.analytic_complete_case]];
  const height = rows.length * 62 + 14;
  ensurePdfSpace(doc, height);
  const x = 118, width = doc.page.width - 236, startY = doc.y + 4;
  rows.forEach((row, index) => {
    const y = startY + index * 62;
    doc.roundedRect(x, y, width, 42, 5).fillAndStroke('#F6F3EA', '#174F3B');
    doc.fillColor('#17211D').fontSize(9);
    pdfText(doc, `${row[0]}    n = ${row[1] ?? '未记录'}`, { x: x + 12, y: y + 13, width: width - 24, align: 'center', lineBreak: false });
    if (index < rows.length - 1) doc.moveTo(x + width / 2, y + 42).lineTo(x + width / 2, y + 60).strokeColor('#174F3B').stroke();
  });
  doc.y = startY + height;
  doc.fillColor('#607067').fontSize(8);
  pdfText(doc, '图 1 研究对象筛选与最终分析样本', { align: 'center', paragraphGap: 6 });
}

function drawPdfForest(doc, result) {
  const row = isGeneric(result)
    ? (result.coefficients || []).find(item => item.term === 'analysis_exposure')
    : (result.coefficients || []).find(item => item.term === 'I(LBXVIDMS/10)');
  if (!row || ![effect(row), row.ci_low, row.ci_high].every(value => Number.isFinite(Number(value)))) return;
  ensurePdfSpace(doc, 104);
  const ratio = !isGeneric(result) || ['odds_ratio', 'rate_ratio', 'risk_ratio'].includes(row.effect_type);
  const nullValue = ratio ? 1 : 0, estimate = Number(effect(row)), low = Number(row.ci_low), high = Number(row.ci_high);
  const padding = Math.max((high - low) * 0.22, 0.1), minimum = Math.min(low, nullValue) - padding, maximum = Math.max(high, nullValue) + padding;
  const left = 110, right = doc.page.width - 78, y = doc.y + 34, x = value => left + (Number(value) - minimum) / (maximum - minimum) * (right - left);
  doc.fillColor('#17211D').fontSize(9); pdfText(doc, '主暴露效应及 95% 置信区间', { paragraphGap: 5 });
  doc.moveTo(x(nullValue), y - 14).lineTo(x(nullValue), y + 18).dash(3, { space: 3 }).strokeColor('#8A9790').stroke().undash();
  doc.moveTo(x(low), y).lineTo(x(high), y).lineWidth(2.5).strokeColor('#2A7F62').stroke();
  doc.circle(x(estimate), y, 4.5).fill('#C77D2A');
  doc.fillColor('#17211D').fontSize(8); pdfText(doc, `${numeric(estimate)} (${numeric(low)}-${numeric(high)})`, { x: right - 120, y: y + 14, width: 120, align: 'right', lineBreak: false });
  doc.y = y + 42;
  doc.fillColor('#607067').fontSize(8); pdfText(doc, '图 2 主暴露效应与 95% 置信区间', { align: 'center', paragraphGap: 6 });
}

function drawPdfSubgroups(doc, result) {
  const rows = (result.subgroupAnalyses || []).filter(row => [effect(row), row.ci_low, row.ci_high].every(value => Number.isFinite(Number(value)))).slice(0, 12);
  if (!rows.length) return;
  const height = 42 + rows.length * 25;
  ensurePdfSpace(doc, Math.min(height, 360));
  const ratio = rows.some(row => ['odds_ratio', 'rate_ratio', 'risk_ratio'].includes(row.effect_type)), nullValue = ratio ? 1 : 0;
  const minimum = Math.min(nullValue, ...rows.map(row => Number(row.ci_low))), maximum = Math.max(nullValue, ...rows.map(row => Number(row.ci_high))), padding = Math.max((maximum - minimum) * .08, .05), lo = minimum - padding, hi = maximum + padding;
  const left = 225, right = doc.page.width - 72, x = value => left + (Number(value) - lo) / (hi - lo) * (right - left), startY = doc.y + 30;
  doc.fillColor('#17211D').fontSize(9); pdfText(doc, '亚组效应与 95% 置信区间', { paragraphGap: 4 });
  doc.moveTo(x(nullValue), startY - 10).lineTo(x(nullValue), startY + rows.length * 25).dash(3, { space: 3 }).strokeColor('#8A9790').stroke().undash();
  rows.forEach((row, index) => {
    const y = startY + index * 25;
    doc.fillColor('#17211D').fontSize(7); pdfText(doc, `${row.subgroup} · ${row.level}`, { x: 58, y: y - 3, width: 155, lineBreak: false });
    doc.moveTo(x(row.ci_low), y).lineTo(x(row.ci_high), y).lineWidth(2).strokeColor('#2A7F62').stroke();
    doc.circle(x(effect(row)), y, 3.5).fill('#C77D2A');
  });
  doc.y = startY + rows.length * 25 + 10;
  doc.fillColor('#607067').fontSize(8); pdfText(doc, '图 3 亚组分析森林图', { align: 'center', paragraphGap: 6 });
}

function drawPdfMissingness(doc, result) {
  const rows = (result.missingnessDiagnostics || []).filter(row => Number.isFinite(Number(row.missing_pct))).sort((a, b) => Number(b.missing_pct) - Number(a.missing_pct)).slice(0, 8);
  if (!rows.length) return;
  const height = 36 + rows.length * 25;
  ensurePdfSpace(doc, height);
  const maximum = Math.max(5, ...rows.map(row => Number(row.missing_pct))), left = 185, chartWidth = doc.page.width - left - 86, startY = doc.y + 25;
  doc.fillColor('#17211D').fontSize(9); pdfText(doc, '分析字段缺失率', { paragraphGap: 4 });
  rows.forEach((row, index) => {
    const y = startY + index * 25, barWidth = chartWidth * Number(row.missing_pct) / maximum;
    doc.fillColor('#17211D').fontSize(7); pdfText(doc, row.variable, { x: 58, y: y - 2, width: 115, lineBreak: false });
    doc.roundedRect(left, y, chartWidth, 10, 2).fill('#EDF3EE');
    doc.roundedRect(left, y, Math.max(1, barWidth), 10, 2).fill('#2A7F62');
    doc.fillColor('#17211D').fontSize(7); pdfText(doc, `${numeric(row.missing_pct, 1)}%`, { x: left + chartWidth + 6, y: y - 2, width: 40, lineBreak: false });
  });
  doc.y = startY + rows.length * 25 + 8;
  doc.fillColor('#607067').fontSize(8); pdfText(doc, '分析字段缺失率图', { align: 'center', paragraphGap: 6 });
}

function createPdfReport(project, result) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 54, right: 54, bottom: 58, left: 54 }, bufferPages: true, info: { Title: project.title || 'NHANES 流行病学研究报告', Author: 'NHANES Research Agent', Subject: 'Quality-gated analysis report' } });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    const font = resolvePdfFont();
    doc.registerFont('report-font', font.file, font.family);
    const content = `${markdownReport(project, result)}\n\n${manuscriptDraft(project, result)}`;
    for (const line of content.replaceAll('\r', '').split('\n')) {
      if (!line.trim()) { doc.moveDown(0.35); continue; }
      if (line.startsWith('# ')) { doc.fillColor('#174f3b').fontSize(20); pdfText(doc, line.slice(2), { align: 'center', paragraphGap: 12 }); }
      else if (line.startsWith('## ')) {
        const heading = cleanMarkdown(line.slice(3));
        if (heading === '样本纳入流程' || heading === '样本流程') ensurePdfSpace(doc, 250);
        else if (heading === '主要模型结果' || heading === '主要结果') ensurePdfSpace(doc, 145);
        doc.fillColor('#174f3b').fontSize(15); pdfText(doc, heading, { paragraphGap: 7 });
        if (heading === '样本纳入流程' || heading === '样本流程') drawPdfFlow(doc, result);
        else if (heading === '主要模型结果' || heading === '主要结果') drawPdfForest(doc, result);
        else if (heading === '高级分析') drawPdfSubgroups(doc, result);
        else if (heading === '缺失数据') drawPdfMissingness(doc, result);
      }
      else if (line.startsWith('### ')) { doc.fillColor('#174f3b').fontSize(12); pdfText(doc, line.slice(4), { paragraphGap: 5 }); }
      else if (line.startsWith('|')) { if (!isDivider(line)) { doc.fillColor('#24342e').fontSize(8); pdfText(doc, tableCells(line).join('  |  '), { paragraphGap: 2 }); } }
      else { doc.fillColor('#17211d').fontSize(10); pdfText(doc, line, { align: 'justify', paragraphGap: 5, lineGap: 2 }); }
    }
    const range = doc.bufferedPageRange();
    for (let page = range.start; page < range.start + range.count; page += 1) {
      doc.switchToPage(page);
      doc.fillColor('#607067').fontSize(8);
      const bottomMargin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      pdfText(doc, `NHANES Research Agent · ${page + 1} / ${range.count}`, { align: 'center', lineBreak: false, width: doc.page.width - 108, x: 54, y: doc.page.height - 34 });
      doc.page.margins.bottom = bottomMargin;
    }
    doc.end();
  });
}

module.exports = { manuscriptDraft, resultTablesCsv, createDocxReport, createPdfReport };
