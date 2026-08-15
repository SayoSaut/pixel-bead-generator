// 色卡范围：标准 221 色 / 完整 291 色
const { ctx, vm } = require("./harness.js");
const assert = require("assert");
const run = (c) => vm.runInContext(c, ctx);
vm.runInContext("globalThis.__set=(n,v)=>{eval(n+' = v')}; globalThis.__get=(n)=>eval(n);", ctx);
const set = run("__set"), get = run("__get");

const P = run("MARD_PALETTE"), N = run("MARD_STANDARD_COUNT");
assert.strictEqual(P.length, 291);
assert.strictEqual(N, 221);
console.log("PASS 色卡：共", P.length, "色 = 标准", N, "+ 扩展", P.length - N);

assert.strictEqual(P[0].code, "A1");
assert.strictEqual(P[220].code, "M15");
assert.strictEqual(P[221].code, "P1");
assert.ok(P.every((e, i) => e.index === i), "index 必须等于数组下标");
assert.strictEqual(new Set(P.map((e) => e.code)).size, P.length, "色号不能重复");
console.log("PASS 索引稳定：标准色仍占 0–220，扩展色从 221 起，切换色卡不会错位");

set("useFullPalette", false);
assert.strictEqual(run("scopedPalette")().length, 221);
set("useFullPalette", true);
assert.strictEqual(run("scopedPalette")().length, 291);
console.log("PASS scopedPalette：切换后可选色数 221 / 291");

function solid(hex, n = 8) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  const data = new Uint8ClampedArray(n*n*4);
  for (let i = 0; i < n*n; i++) { data[i*4]=r; data[i*4+1]=g; data[i*4+2]=b; data[i*4+3]=255; }
  return { width:n, height:n, data };
}
const img = solid("#FFFF00"); // 纯黄，只有扩展系列的 Q3 能精确命中

set("useFullPalette", true);
const fullPick = P[run("quantizeIndices")(img, null)[0]];
set("useFullPalette", false);
const stdPick = P[run("quantizeIndices")(img, null)[0]];
console.log(`纯黄 #FFFF00 → 完整色卡 ${fullPick.code} (${fullPick.hex})，标准色卡 ${stdPick.code} (${stdPick.hex})`);
assert.strictEqual(fullPick.code, "Q3", "完整模式应精确命中 Q3");
assert.ok(stdPick.index < N, "标准模式绝不能选到扩展色");
console.log("PASS 限定范围：标准模式下扩展色不会出现");

let leaks = 0;
for (let i = 0; i < 300; i++) {
  const hex = "#" + [0,1,2].map(() => Math.floor(Math.random()*256).toString(16).padStart(2,"0")).join("");
  if (run("quantizeIndices")(solid(hex, 2), null)[0] >= N) leaks++;
}
assert.strictEqual(leaks, 0, leaks + " 个随机颜色配到了扩展色");
console.log("PASS 300 个随机色在标准模式下全部落在 221 色内");

const pick = run("nearestInPalette")(255, 255, 0, run("scopedPalette")());
assert.ok(pick.index < N, "吸管取色也必须受限");
console.log("PASS 吸管取色同样受色卡范围限制 →", pick.code);

const mix = (() => {
  const n = 40, data = new Uint8ClampedArray(n*n*4);
  let s = 5; const rr = () => ((s = (s*1103515245+12345)&0x7fffffff)/0x7fffffff);
  for (let i = 0; i < n*n; i++) { data[i*4]=rr()*255; data[i*4+1]=rr()*255; data[i*4+2]=rr()*255; data[i*4+3]=255; }
  return { width:n, height:n, data };
})();
const reduced = run("buildReducedPalette")(mix, 12);
assert.ok(reduced.every((e) => e.index < N), "限色调色板也不能引入扩展色");
console.log("PASS 卡通化限色：k-means 选出的", reduced.length, "色全部在标准色卡内");
console.log("\nALL PALETTE-SCOPE TESTS PASSED");
