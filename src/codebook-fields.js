function plain(value) {
  return String(value).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&micro;|&#181;/g,'µ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
}
function extractFields(section) {
  const text = plain(section);
  const label = text.match(/SAS Label:\s*(.*?)\s*English Text:/i)?.[1] || null;
  const description = text.match(/English Text:\s*(.*?)\s*Target:/i)?.[1] || null;
  const target = text.match(/Target:\s*(.*?)(?:Code or Value|$)/i)?.[1]?.trim() || null;
  const unit = label?.match(/\((µg\/dL|ug\/dL|umol\/L|µmol\/L|nmol\/L|mg\/dL|mmHg|kg\/m\*?2|kg\/m²)\)/i)?.[1] || null;
  const values = [];
  for (const row of section.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(x=>plain(x[1]));
    if(cells.length >= 2 && cells[0] && cells[1]) values.push({code:cells[0],description:cells[1]});
  }
  const missingCodes = values.filter(x=>/^(Missing|Refused|Don't know|Do not know)$/i.test(x.description));
  return { label, description, target, unit, values, missingCodes, status:'extracted_not_approved', unresolved:['确认特殊编码处理','确认抽样权重与子样本资格','确认单位和跨周期实验室方法'], basis:'literal codebook labels and table rows; no inferred recoding' };
}
module.exports = { extractFields };
