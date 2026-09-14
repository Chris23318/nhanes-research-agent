const test=require('node:test');
const assert=require('node:assert/strict');
const {fetchOfficialCatalog}=require('../src/cdc-catalog');
const {discoverVariableMap}=require('../src/variable-discovery');
test('internal discovery searches beyond the public 500-row display limit',async()=>{
 const html=Array.from({length:501},(_,i)=>`<tr><td>V${i}</td><td>lead</td><td>LAB_J</td><td>Lead</td><td>2017</td><td>2018</td><td>Laboratory</td><td>None</td></tr>`).join('');
 const result=await fetchOfficialCatalog({component:'Laboratory'},{internalDiscovery:true,fetchImpl:async()=>({ok:true,text:async()=>html})});
 assert.equal(result.items.length,501);
});
test('candidate discovery excludes a known unrequested cycle',async()=>{
 const intent={exposure:{term:'lead',component:'Laboratory'},outcome:{term:'pressure'},cycles:['2017-2018']};
 const row={variable:'LEAD',description:'lead',file:'LAB_J',beginYear:'2017',endYear:'2018'};
 const result=await discoverVariableMap(intent,{fetchCatalog:async()=>({items:[row,{...row,variable:'OLD',beginYear:'2015',endYear:'2016'}]})});
 assert.deepEqual(result.discovery.candidates[0].items.map(x=>x.variable),['LEAD']);
 assert.deepEqual(result.discovery.candidates[0].items[0].matchedCycles,['2017-2018']);
});
