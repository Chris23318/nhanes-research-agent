const CDC_HOST = 'wwwn.cdc.gov';
const SUFFIXES = { '2007-2008': 'E', '2009-2010': 'F', '2011-2012': 'G', '2013-2014': 'H', '2015-2016': 'I', '2017-2018': 'J' };
const ALLOWED_FILES = new Set(['DEMO', 'VID', 'DPQ', 'BMX']);
const cache = new Map();

function buildDataManifest(project) {
  const cycles = project.intent?.cycles || [];
  const sources = [...new Set((project.variables || []).map(item => item.source).filter(source => ALLOWED_FILES.has(source)))];
  const files = [];
  for (const cycle of cycles) {
    const suffix = SUFFIXES[cycle]; if (!suffix) continue;
    for (const source of sources) {
      const code = `${source}_${suffix}`, year = cycle.slice(0, 4), base = `https://${CDC_HOST}/Nchs/Data/Nhanes/Public/${year}/DataFiles/${code}`;
      files.push({ cycle, component: source, code, format: 'SAS XPT', url: `${base}.XPT`, documentationUrl: `${base}.htm`, requiredJoinKey: 'SEQN' });
    }
  }
  return {
    schemaVersion: '1.0', publisher: 'CDC/NCHS', generatedAt: new Date().toISOString(), cycles, files,
    analyticNotes: sources.includes('VID') ? [{ topic: 'Vitamin D', rule: 'Use total 25(OH)D LBXVIDMS in nmol/L for 2007-2018; do not sum mass concentrations.', url: 'https://wwwn.cdc.gov/Nchs/Nhanes/VitaminD/AnalyticalNote.aspx' }] : [],
    warning: 'Availability validation checks the official file signature and size; variable values and cycle-specific codebooks still require review.'
  };
}

async function validateFile(file, options = {}) {
  const cached = cache.get(file.url); if (cached && Date.now() - cached.checkedMs < 3600000) return cached.value;
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), options.timeoutMs || 15000);
  try {
    const response = await (options.fetchImpl || fetch)(file.url, { signal: controller.signal, headers: { Range: 'bytes=0-79', 'User-Agent': 'nhanes-research-agent/1.0' } });
    const bytes = Buffer.from(await response.arrayBuffer()), range = response.headers.get('content-range') || '';
    const totalBytes = Number(range.match(/\/(\d+)$/)?.[1] || response.headers.get('content-length') || 0);
    const value = { ...file, available: response.ok, status: response.status, signatureValid: bytes.toString('ascii').startsWith('HEADER RECORD'), totalBytes, checkedAt: new Date().toISOString() };
    value.valid = value.available && value.signatureValid && value.totalBytes > 80; cache.set(file.url, { checkedMs: Date.now(), value }); return value;
  } finally { clearTimeout(timer); }
}

async function validateDataManifest(manifest, options = {}) {
  const results = [];
  for (let index = 0; index < manifest.files.length; index += 4) results.push(...await Promise.all(manifest.files.slice(index, index + 4).map(file => validateFile(file, options))));
  return { ...manifest, validatedAt: new Date().toISOString(), files: results, summary: { total: results.length, valid: results.filter(item => item.valid).length, invalid: results.filter(item => !item.valid).length, totalBytes: results.reduce((sum, item) => sum + item.totalBytes, 0) } };
}

module.exports = { CDC_HOST, SUFFIXES, buildDataManifest, validateFile, validateDataManifest };
