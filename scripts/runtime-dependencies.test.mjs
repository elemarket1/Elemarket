import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {builtinModules} from 'node:module';
const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(d=>d.isDirectory()?files(path.join(dir,d.name)):/\.[cm]?[jt]sx?$/.test(d.name)?[path.join(dir,d.name)]:[]);}
test('every direct application and server runtime import is declared as a production dependency',()=>{
 for(const file of [...files('src'),...files('server')]) {
  const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
  function visit(node){
   let specifier;
   if(ts.isImportDeclaration(node)&&!node.importClause?.isTypeOnly)specifier=node.moduleSpecifier;
   if(ts.isExportDeclaration(node)&&!node.isTypeOnly)specifier=node.moduleSpecifier;
   if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword)specifier=node.arguments[0];
   if(specifier&&ts.isStringLiteral(specifier)){
    const id=specifier.text;
    if(!id.startsWith('.')&&!id.startsWith('@/')&&!id.startsWith('#')&&!id.startsWith('node:')&&!builtinModules.includes(id)) {
     const name=id.startsWith('@')?id.split('/').slice(0,2).join('/'):id.split('/')[0];assert.ok(pkg.dependencies[name],`${file}: missing runtime dependency ${name}`);
    }
   }ts.forEachChild(node,visit);
  }visit(source);
 }
});
