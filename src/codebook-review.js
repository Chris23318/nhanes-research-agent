const crypto = require('node:crypto');
const { fileMatchesCycle } = require('./data-manifest');
function codebookUrl(file, cycle) {
  if (!/^[A-Z][A-Z0-9_]{1,40}$/.test(file) || !fileMatchesCycle(file,cycle)) throw new Error('文件与受支持周期不匹配');
  return `https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/${cycle.slice(0,4)}/DataFiles/${file}.htm`;
}
async function inspectCodebook(selection, cycle, options = {}) {
  const url = codebookUrl(selection.file, cycle);
  if (!/^[A-Z][A-Z0-9_]{0,39}$/.test(selection.variable)) throw new Error('无效变量标识');
  const response = await (options.fetchImpl || fetch)(url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`CDC_HTTP_${response.status}`);
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 2000000) { await reader.cancel(); throw new Error('CODEBOOK_TOO_LARGE'); } chunks.push(Buffer.from(value)); } } finally { reader.releaseLock(); }
  const bytes = Buffer.concat(chunks), html = bytes.toString('utf8');
  const marker = new RegExp(`<(?:a|h[1-6]|div)\\b[^>]*(?:id|name)=["']${selection.variable}["'][^>]*>`, 'i');
  const match = marker.exec(html);
  let excerpt = '', section = '';
  if (match) {
    const tail = html.slice(match.index + match[0].length);
    const end = tail.search(/<h3\b|<div\b[^>]*class=["'][^"']*codebook/i);
    section = tail.slice(0, end < 0 ? 12000 : Math.min(end,12000));
    excerpt = tail.slice(0, end < 0 ? 12000 : Math.min(end, 12000)).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 8000);
  }
  return { role: selection.role, variable: selection.variable, file: selection.file, cycle, url, selectedAt: selection.selectedAt, retrievedAt: new Date().toISOString(), sha256: crypto.createHash('sha256').update(bytes).digest('hex'), bytes: size, variableFound: Boolean(match), excerpt, fields: match ? require('./codebook-fields').extractFields(section) : null, status: match ? 'researcher_review_required' : 'variable_not_found', warning: '字段按原文提取，尚未批准清洗规则。单位、缺失码、适用人群、抽样权重与跨周期一致性仍须确认。' };
}
module.exports = { codebookUrl, inspectCodebook };
