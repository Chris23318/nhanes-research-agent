const http=require('http'),fs=require('fs'),path=require('path');
const {createProject,getProject,listProjects,runProject,approveProject,saveEvidence,subscribe}=require('./src/orchestrator');
const {searchCatalog}=require('./src/catalog');
const {searchPubMed}=require('./src/pubmed');
const {generateRProject}=require('./src/analysis-package');
const {fetchOfficialCatalog}=require('./src/cdc-catalog');
const {parseQuestion}=require('./src/question-parser');
const root=__dirname,types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.md':'text/markdown; charset=utf-8'};
function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value))}
async function body(req){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>65536){const e=new Error('request body too large');e.status=413;throw e}chunks.push(chunk)}if(!chunks.length)return{};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{const e=new Error('invalid JSON');e.status=400;throw e}}
async function api(req,res,url){
  if(req.method==='GET'&&url.pathname==='/api/health')return json(res,200,{status:'ok',service:'nhanes-research-agent',mode:'demo'});
  if(req.method==='GET'&&url.pathname==='/api/catalog/variables')return json(res,200,{items:searchCatalog(url.searchParams.get('q')||''),mode:'verified-demo-snapshot'});
  if(req.method==='GET'&&url.pathname==='/api/catalog/cdc'){return json(res,200,await fetchOfficialCatalog({component:url.searchParams.get('component')||'Demographics',cycle:url.searchParams.get('cycle')||'',query:url.searchParams.get('q')||'',limit:url.searchParams.get('limit')||100}))}
  if(req.method==='POST'&&url.pathname==='/api/tools/pubmed/search'){const input=await body(req);return json(res,200,await searchPubMed(input,{email:process.env.NCBI_EMAIL,apiKey:process.env.NCBI_API_KEY,tool:'nhanes_research_agent'}))}
  if(req.method==='POST'&&url.pathname==='/api/tools/parse-question'){const input=await body(req);return json(res,200,parseQuestion(input.question||''))}
  if(req.method==='POST'&&url.pathname==='/api/projects')return json(res,201,createProject(await body(req)));
  if(req.method==='GET'&&url.pathname==='/api/projects')return json(res,200,{items:listProjects(url.searchParams.get('limit'))});
  const match=url.pathname.match(/^\/api\/projects\/([^/]+)(?:\/(run|approve|events|analysis-package|evidence))?$/);if(!match)return json(res,404,{error:{code:'NOT_FOUND',message:'route not found'}});
  const [,projectId,action]=match;
  if(req.method==='GET'&&!action)return json(res,200,getProject(projectId));
  if(req.method==='POST'&&action==='run'){runProject(projectId).catch(console.error);return json(res,202,{projectId,status:'running'})}
  if(req.method==='POST'&&action==='approve')return json(res,200,approveProject(projectId,await body(req)));
  if(req.method==='POST'&&action==='evidence')return json(res,200,saveEvidence(projectId,await body(req)));
  if(req.method==='GET'&&action==='analysis-package')return json(res,200,generateRProject(getProject(projectId)));
  if(req.method==='GET'&&action==='events'){const project=getProject(projectId);res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache',Connection:'keep-alive'});for(const event of project.events)res.write(`data: ${JSON.stringify(event)}\n\n`);const off=subscribe(projectId,event=>res.write(`data: ${JSON.stringify(event)}\n\n`));req.on('close',off);return}
  return json(res,405,{error:{code:'METHOD_NOT_ALLOWED',message:'method not allowed'}})
}
function staticFile(res,url){const target=url.pathname==='/'?'index.html':url.pathname.slice(1),file=path.normalize(path.join(root,target));if(!file.startsWith(root)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);return res.end('Not found')}res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});fs.createReadStream(file).pipe(res)}
const server=http.createServer(async(req,res)=>{const url=new URL(req.url,'http://localhost');try{if(url.pathname.startsWith('/api/'))await api(req,res,url);else staticFile(res,url)}catch(error){if(!res.headersSent)json(res,error.status||500,{error:{code:error.code||'INTERNAL_ERROR',message:error.status?error.message:'internal server error'}})}});
if(require.main===module)server.listen(process.env.PORT||4173,()=>console.log('NHANES Lab: http://localhost:4173'));
module.exports={server};
