import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const path = 'src/routes/auth.tsx';
const source = fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'handlePasswordReset') handler = node.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(handler, 'Test the actual UI handler');
const js = ts.transpileModule(handler, {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
function setup({email=' tester@example.com ', loading=false, error=null, reject=false}={}) {
  const calls=[], notices=[], busy=[];
  const run=vm.runInNewContext(`${js}; handlePasswordReset`, {
    email, loading, Error,
    setLoading: value=>busy.push(value),
    window:{location:{origin:'https://restpilotai.com'}},
    toast:{error:value=>notices.push(['error',value]),success:value=>notices.push(['success',value])},
    supabase:{auth:{resetPasswordForEmail:async(...args)=>{
      calls.push(args); if(reject) throw new Error('Network unavailable'); return {error};
    }}},
  });
  return {run,calls,notices,busy};
}
test('provider rejection never displays reset-email success and permits retry',async()=>{
  const h=setup({error:new Error('Request rate limit reached')}); await h.run();
  assert.deepEqual(h.notices,[['error','Request rate limit reached']]);
  assert.deepEqual(h.busy,[true,false]);
});
test('network rejection displays an error and releases loading',async()=>{
  const h=setup({reject:true});await h.run();
  assert.equal(h.notices[0][0],'error');assert.deepEqual(h.busy,[true,false]);
});
test('successful request trims address, preserves recovery route and neutral account wording',async()=>{
  const h=setup();await h.run();
  assert.equal(h.calls[0][0],'tester@example.com');
  assert.equal(h.calls[0][1].redirectTo,'https://restpilotai.com/reset-password');
  assert.deepEqual(h.notices,[['success','If that email exists, a reset link is on the way.']]);
});
test('blank address never contacts provider',async()=>{
  const h=setup({email:'   '});await h.run();assert.equal(h.calls.length,0);assert.equal(h.notices[0][0],'error');
});
test('pending auth operation prevents another reset request',async()=>{
  const h=setup({loading:true});await h.run();assert.equal(h.calls.length,0);assert.equal(h.notices.length,0);
});
