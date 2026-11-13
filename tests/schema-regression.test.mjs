import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { z } from 'zod';

// Load the actual schema declarations, not copies. No route/server IO runs.
function schemas(path, names) {
  const file=ts.createSourceFile(path,fs.readFileSync(new URL('../'+path,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const statements=file.statements.filter(s=>ts.isVariableStatement(s)&&s.declarationList.declarations.some(d=>names.includes(d.name.getText(file))));
  assert.equal(statements.length,names.length);
  const source=statements.map(s=>s.getText(file)).join('\n');
  const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  return vm.runInNewContext(`${js}\n({${names.join(',')}})`,{z});
}
const inbox=schemas('src/routes/inbox.tsx',['searchSchema']).searchSchema;
test('inbox accepts trimmed strings and absent optional fields',()=>{
 assert.equal(inbox.parse({add:'  Bring lunch  '}).add,'Bring lunch');
 assert.equal(inbox.parse({}).add,undefined);
});
test('inbox invalid deep-link fields fall back independently without coercion',()=>{
 const r=inbox.parse({add:42,complete:' valid ',other:'ignored'});
 assert.equal(r.add,undefined);assert.equal(r.complete,'valid');assert.equal(r.other,undefined);
 assert.equal(inbox.parse({add:'x'.repeat(281)}).add,undefined);
});
const personal=schemas('src/lib/personal/personal.functions.ts',['upsertSchema']).upsertSchema;
test('personal task default, trimming and nullable fields preserve behavior',()=>{
 const r=personal.parse({title:' Task ',notes:null});assert.equal(r.kind,'task');assert.equal(r.title,'Task');assert.equal(r.notes,null);
});
test('personal priority is not coerced and invalid dates/blank titles fail',()=>{
 for(const payload of [{title:'Task',priority:'2'},{title:' '},{title:'Task',dueAt:'tomorrow'}]) assert.equal(personal.safeParse(payload).success,false);
});
const weather=schemas('src/lib/weather/weather.functions.ts',['setLocationSchema']).setLocationSchema;
test('coordinates require actual numbers inside geographic bounds',()=>{
 assert.equal(weather.safeParse({lat:90,lon:-180}).success,true);
 assert.equal(weather.safeParse({lat:'90',lon:0}).success,false);
 assert.equal(weather.safeParse({lat:91,lon:0}).success,false);
});
const device=schemas('src/lib/smart-home/devices.functions.ts',['DEVICE_KINDS','DEVICE_VENDORS','upsertSchema']).upsertSchema;
test('device defaults and record values remain validated',()=>{
 assert.equal(device.parse({label:'Lamp',kind:'light',capabilities:{dim:true}}).vendor,'manual');
 assert.equal(device.safeParse({label:'Lamp',kind:'light',capabilities:{dim:'true'}}).success,false);
});
const automation=schemas('src/lib/automations/automations.functions.ts',['AUTOMATION_KINDS','triggerSchema','stepSchema','upsertSchema']).upsertSchema;
test('automation union variants and collection limits reject invalid operations',()=>{
 const base={name:'Night',kind:'bedtime',trigger:{type:'manual'},steps:[{type:'wait',seconds:5}]};
 assert.equal(automation.safeParse(base).success,true);
 assert.equal(automation.safeParse({...base,steps:[{type:'wait',seconds:'5'}]}).success,false);
 assert.equal(automation.safeParse({...base,steps:Array(41).fill({type:'sound_stop'})}).success,false);
});
const contact=schemas('src/routes/api/public/contact.ts',['ContactSchema']).ContactSchema;
test('contact requires valid email and bounded content',()=>{
 assert.equal(contact.safeParse({email:'person@example.com',message:'Hello'}).success,true);
 assert.equal(contact.safeParse({email:'not-email',message:'Hello'}).success,false);
 assert.equal(contact.safeParse({email:'person@example.com',message:'x'.repeat(4001)}).success,false);
});
