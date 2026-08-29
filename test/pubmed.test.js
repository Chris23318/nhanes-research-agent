const test=require('node:test');
const assert=require('node:assert/strict');
const {buildQuery,searchPubMed}=require('../src/pubmed');

test('PubMed query strips control syntax from concepts',()=>{
  const query=buildQuery({exposure:'vitamin D[evil]',outcome:'depression"',nhanesOnly:true});
  assert.ok(!query.includes('[evil]'));
  assert.match(query,/NHANES/);
});

test('PubMed adapter returns audited summaries',async()=>{
  const fetchImpl=async url=>({ok:true,json:async()=>new URL(url).pathname.endsWith('/esearch.fcgi')?{esearchresult:{count:'1',idlist:['123']}}:{result:{'123':{uid:'123',title:'A study',source:'Journal',pubdate:'2024',authors:[{name:'Researcher A'}],articleids:[{idtype:'doi',value:'10.1/test'}]}}}});
  const result=await searchPubMed({query:'vitamin D AND NHANES',limit:5},{fetchImpl,timeoutMs:100});
  assert.equal(result.articles[0].pmid,'123');
  assert.equal(result.articles[0].doi,'10.1/test');
  assert.equal(result.source,'NCBI PubMed E-utilities');
});
