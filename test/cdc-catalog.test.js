const test=require('node:test');
const assert=require('node:assert/strict');
const {buildCatalogUrl,fetchOfficialCatalog}=require('../src/cdc-catalog');

test('CDC catalog URL is fixed to the official host',()=>{
  const url=buildCatalogUrl({component:'Laboratory',cycle:'2017-2018'});
  assert.equal(url.hostname,'wwwn.cdc.gov');assert.equal(url.searchParams.get('Cycle'),'2017-2018');
  assert.throws(()=>buildCatalogUrl({component:'https://evil.test'}),/unsupported/);
});

test('CDC catalog parser returns structured variables',async()=>{
  const html='<table><tr><th>Variable Name</th></tr><tr><td>LBXVIDMS</td><td>25OHD2+25OHD3 (nmol/L)</td><td>VID_J</td><td>Vitamin D</td><td>2017</td><td>2018</td><td>Laboratory</td><td>None</td></tr></table>';
  const fetchImpl=async()=>({ok:true,text:async()=>html});
  const result=await fetchOfficialCatalog({component:'Laboratory',cycle:'2017-2018',query:'vitamin'},{fetchImpl,timeoutMs:100});
  assert.equal(result.items[0].variable,'LBXVIDMS');assert.equal(result.source,'CDC/NCHS NHANES');
});
