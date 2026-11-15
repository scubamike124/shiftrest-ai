// Load a checked-in TypeScript module (CommonJS transpile) with stubbed imports.
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

export function loadTs(relPath, { modules = {}, globals = {} } = {}) {
  const src = fs.readFileSync(new URL('../' + relPath, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  const require = (name) => {
    if (name in modules) return modules[name];
    throw new Error(`Unexpected import ${name} from ${relPath}`);
  };
  // Same realm as the test, so deepStrictEqual compares plain arrays/objects.
  const names = Object.keys(globals);
  vm.compileFunction(js, ['module', 'exports', 'require', ...names])(module, module.exports, require, ...names.map((n) => globals[n]));
  return module.exports;
}
