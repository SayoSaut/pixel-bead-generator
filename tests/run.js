// 一次跑完所有测试：node tests/run.js
const { execFileSync } = require("child_process");
const fs = require("fs"), path = require("path");
const files = fs.readdirSync(__dirname).filter((f) => /^test_.*\.m?js$/.test(f)).sort();
let failed = 0;
for (const f of files) {
  try {
    execFileSync(process.execPath, [path.join(__dirname, f)], { stdio: "inherit" });
  } catch { failed++; console.error(`\n!! ${f} 失败\n`); }
}
console.log(failed ? `\n${failed}/${files.length} 组测试失败` : `\n全部 ${files.length} 组测试通过`);
process.exit(failed ? 1 : 0);
