'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),manifest=JSON.parse(fs.readFileSync(path.join(root,'source-files.json')));
for(const [file,expected] of Object.entries(manifest.files)){
 const absolute=path.resolve(root,file);assert.ok(absolute.startsWith(root+path.sep));
 const data=fs.readFileSync(absolute);assert.equal(crypto.createHash('sha256').update(data).digest('hex'),expected,'来源哈希不符：'+file);
 if(/\.(?:cjs|js)$/.test(file))for(const match of data.toString().matchAll(/require\(['"]([^'"]+)['"]\)/g)){
  const spec=match[1];if(spec.startsWith('.')){const target=path.resolve(path.dirname(absolute),spec);assert.ok(target.startsWith(root+path.sep),'跨项目依赖：'+file);assert.ok(fs.existsSync(target),'缺失依赖：'+spec);}else assert.ok(spec==='electron'||require('node:module').isBuiltin(spec),'未声明依赖：'+spec);
 }
}
assert.equal(Object.keys(require('../package.json').dependencies||{}).length,0);
console.log(JSON.stringify({success:true,files:Object.keys(manifest.files).length,independent:true}));
