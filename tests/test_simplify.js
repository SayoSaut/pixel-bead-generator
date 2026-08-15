// 卡通化简化、辅助线位置、镜像
const { ctx, vm } = require("./harness.js");
const assert = require("assert");
const run = (c) => vm.runInContext(c, ctx);
const P = run("MARD_PALETTE");
const byCode = Object.fromEntries(P.map((e) => [e.code, e]));
vm.runInContext("globalThis.__set=(n,v)=>{eval(n+' = v')}; globalThis.__get=(n)=>eval(n);", ctx);
const set = run("__set");

// 带噪点的渐变 —— 正是这种图会被配成一片穿插的相近色
function noisyGradient(W, H) {
  const data = new Uint8ClampedArray(W * H * 4);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) * 26;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4, t = y / (H - 1);
    data[o] = 210 - 190 * t + rnd(); data[o+1] = 235 - 150 * t + rnd();
    data[o+2] = 250 - 90 * t + rnd(); data[o+3] = 255;
  }
  return { width: W, height: H, data };
}
const grad = noisyGradient(64, 64);
const fullColors = new Set(run("quantizeIndices")(grad, null)).size;
const pal = run("buildReducedPalette")(grad, 6);
const reducedColors = new Set(run("quantizeIndices")(grad, pal)).size;
console.log(`带噪点的渐变：不限色 ${fullColors} 种豆 → 限色后 ${reducedColors} 种`);
assert.ok(fullColors > reducedColors && reducedColors <= 6);
console.log("PASS buildReducedPalette：渐变塌缩成大色块");

// 平滑 + 清理要消掉的是「跳豆」——孤立的单颗豆子，也就是拼的时候要单独
// 找一颗、拼完还看不见的那些。注意衡量的是孤立数量而不是某个颜色的总数：
// 平滑做的是把噪点聚成团，不是把某种颜色整个消灭。
const A = byCode.A1, B = byCode.B12, C = byCode.C4;
let sd = 11;
const rand01 = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
let noise = Array.from({ length: 16 }, () => Array.from({ length: 16 }, () => (rand01() < 0.5 ? A : B)));
const strays = (g, n = 16) => {
  let k = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const c = g[y][x]; if (!c) continue;
    let same = 0;
    for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const q = g[y+dy] && g[y+dy][x+dx];
      if (q && q.index === c.index) same++;
    }
    if (!same) k++;
  }
  return k;
};
const before = strays(noise);
run("smoothCellsByMajority")(noise, 16, 16, 3, 5);
const mid = strays(noise);
run("removeSmallRegions")(noise, 16, 16, 3);
const after = strays(noise);
console.log(`随机噪点的孤立跳豆：${before} → 平滑后 ${mid} → 清理后 ${after}`);
assert.ok(mid < before, "平滑应减少孤立跳豆");
assert.strictEqual(after, 0, "清理后不应残留孤立跳豆，实际 " + after);
console.log("PASS 平滑 + 清理：孤立跳豆归零");

let keep = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => A));
for (let y = 3; y <= 5; y++) for (let x = 3; x <= 5; x++) keep[y][x] = C;
run("smoothCellsByMajority")(keep, 9, 9, 2, 5);
assert.strictEqual(keep[4][4].code, "C4", "3×3 的真实细节不能被平滑掉");
console.log("PASS smoothCellsByMajority：3×3 真实细节保留（阈值保护）");

let cells = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => A));
cells[4][4] = B;
for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) cells[y][x] = C;
run("removeSmallRegions")(cells, 9, 9, 3);
assert.strictEqual(cells[4][4].code, "A1", "单颗跳豆应被吸收");
assert.strictEqual(cells[2][2].code, "C4", "3×3 色块必须保留");
console.log("PASS removeSmallRegions：单颗跳豆被吸收，3×3 色块保留");

let c2 = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => A));
c2[1][1] = B;
run("removeSmallRegions")(c2, 4, 4, 1);
assert.strictEqual(c2[1][1].code, "B12", "关闭档位不应改动任何格子");
console.log("PASS removeSmallRegions：关闭档位是空操作");

let c3 = Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => A));
c3[2][2] = null;
run("removeSmallRegions")(c3, 5, 5, 4);
assert.strictEqual(c3[2][2], null, "抠图空洞不能被填上");
console.log("PASS removeSmallRegions / 平滑：抠图空洞保持为空");

const cl = run("centeredLines");
// 10 格的数数辅助线
for (const [size, expect] of [[52, 1], [78, 4], [104, 2]]) {
  const lines = cl(size, 10);
  assert.strictEqual(lines[0], expect, `${size} 板边距应为 ${expect}`);
  assert.strictEqual(lines[lines.length - 1], size - expect, "两侧边距必须相等");
  console.log(`PASS ${size}×${size} 辅助线：边距 ${expect}，${lines.length} 条 → ${lines.join(",")}`);
}

// 26 格的拼板接缝线 —— 整数倍时从 0 开始，非整数倍时居中
for (const [size, expect] of [[52, [0,26,52]], [78, [0,26,52,78]], [104, [0,26,52,78,104]],
                              [40, [7,33]], [60, [4,30,56]], [100, [11,37,63,89]]]) {
  const lines = cl(size, 26);
  assert.strictEqual(JSON.stringify(lines), JSON.stringify(expect),
    `${size} 板接缝线应为 ${expect}，实际 ${lines}`);
  const left = lines[0], right = size - lines[lines.length - 1];
  assert.strictEqual(left, right, `${size}: 两侧余量必须相等（${left} vs ${right}）`);
  console.log(`PASS ${size} 板接缝线居中：${lines.join(",")}（两侧各余 ${left} 格）`);
}

// 板子比一块实体板还小时，没有接缝可画
assert.strictEqual(JSON.stringify(cl(20, 26)), "[]", "小于 26 格时不应画接缝线");
console.log("PASS 板子小于一块实体板时不画接缝线");

set("boardW", 52), set("boardH", 52), set("boardSize", 52);
run("cellEditor").hidden = true;
const mk = () => [
  [byCode.A1, byCode.A9, byCode.B2, byCode.C4],
  [byCode.D1, byCode.E5, byCode.F3, byCode.H2],
  [byCode.A1, byCode.A1, byCode.B2, byCode.B2],
];
let mc = mk();
set("lastPattern", { gridW: 4, gridH: 3, cells: mc });
set("editorSelection", new Set());
run("mirrorPattern")("h");
assert.strictEqual(mc[0].map((c) => c.code).join(","), "C4,B2,A9,A1");
console.log("PASS 镜像：未选中时整张水平翻转");

run("mirrorPattern")("v");
assert.strictEqual(mc[0].map((c) => c.code).join(","), "B2,B2,A1,A1", "垂直翻转后首行 = 上一步水平翻转后的末行");
console.log("PASS 镜像：垂直翻转，首行变为原末行");

const key = run("cellKey");
mc = mk();
set("lastPattern", { gridW: 4, gridH: 3, cells: mc });
set("editorSelection", new Set([key(0, 0), key(1, 0)]));
run("mirrorPattern")("h");
assert.strictEqual(mc[0].map((c) => c.code).join(","), "A9,A1,B2,C4", "只翻转选区包围盒");
assert.strictEqual(mc[1].map((c) => c.code).join(","), "D1,E5,F3,H2", "选区外不受影响");
console.log("PASS 镜像：局部只翻转框选的包围盒");
console.log("\nALL SIMPLIFY/MIRROR TESTS PASSED");
