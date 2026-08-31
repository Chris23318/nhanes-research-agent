const BASE='https://wwwn.cdc.gov/nchs/nhanes/Search/variablelist.aspx';
const COMPONENTS=new Set(['Demographics','Dietary','Examination','Laboratory','Questionnaire']);
const CYCLES=/^(1999-2000|20\d{2}-20\d{2}|2021-2023)$/;
const entities={'&amp;':'&','&quot;':'"','&#39;':"'",'&lt;':'<','&gt;':'>','&nbsp;':' '};
const clean=value=>String(value||'').replace(/<[^>]+>/g,' ').replace(/&(?:amp|quot|#39|lt|gt|nbsp);/g,x=>entities[x]||x).replace(/\s+/g,' ').trim();

function buildCatalogUrl({component='Demographics',cycle=''}){
  if(!COMPONENTS.has(component)){const e=new Error('unsupported NHANES component');e.status=400;e.code='VALIDATION_ERROR';throw e}
  if(cycle&&!CYCLES.test(cycle)){const e=new Error('invalid NHANES cycle');e.status=400;e.code='VALIDATION_ERROR';throw e}
  const url=new URL(BASE);url.searchParams.set('Component',component);url.searchParams.set('Cycle',cycle);return url;
}

async function fetchOfficialCatalog(input={},options={}){
  const url=buildCatalogUrl(input),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),options.timeoutMs||12000);
  try{
    const response=await(options.fetchImpl||fetch)(url,{signal:controller.signal,headers:{'User-Agent':'nhanes-research-agent/0.4','Accept':'text/html'}});
    if(!response.ok){const e=new Error(`CDC catalog request failed with ${response.status}`);e.status=502;e.code='UPSTREAM_ERROR';throw e}
    const html=await response.text(),rows=[...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)],items=[];
    for(const row of rows){const cells=[...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(x=>clean(x[1]));if(cells.length<8||!cells[0]||cells[0]==='Variable Name')continue;items.push({variable:cells[0],description:cells[1],file:cells[2],fileDescription:cells[3],beginYear:cells[4],endYear:cells[5],component:cells[6],constraints:cells[7]})}
    const query=clean(input.query).toLowerCase(),filtered=query?items.filter(x=>`${x.variable} ${x.description} ${x.file} ${x.fileDescription}`.toLowerCase().includes(query)):items;
    return{source:'CDC/NCHS NHANES',sourceUrl:url.toString(),retrievedAt:new Date().toISOString(),component:input.component||'Demographics',cycle:input.cycle||'all',items:filtered.slice(0,Math.min(Number(input.limit)||100,500)),totalMatched:filtered.length}
  }finally{clearTimeout(timer)}
}

module.exports={BASE,COMPONENTS,buildCatalogUrl,fetchOfficialCatalog};
