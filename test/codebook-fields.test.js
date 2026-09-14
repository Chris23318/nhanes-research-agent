const test=require('node:test'),assert=require('node:assert/strict');
const {extractFields}=require('../src/codebook-fields');
test('extracts literal labels and separates missing codes from real values',()=>{
 const value=extractFields('<p>SAS Label: Blood lead (ug/dL) English Text: Blood lead Target: Both males and females 6 YEARS - 150 YEARS Code or Value</p><table><tr><td>77</td><td>Refused</td></tr><tr><td>0</td><td>Zero measurement</td></tr><tr><td>.</td><td>Missing</td></tr></table>');
 assert.equal(value.unit,'ug/dL');assert.deepEqual(value.missingCodes.map(x=>x.code),['77','.']);assert.match(value.target,/6 YEARS/);assert.equal(value.status,'extracted_not_approved');
});
test('unknown units stay unresolved rather than invented',()=>{assert.equal(extractFields('SAS Label: Score English Text: Score Target: All').unit,null)});
