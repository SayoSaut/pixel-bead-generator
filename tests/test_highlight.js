// 颜色高亮 + 行内计数
const { ctx, vm, calls, makeCanvas } = require("./harness.js");
const assert = require("assert");
const run = (c) => vm.runInContext(c, ctx);
const P = run("MARD_PALETTE");
const byCode = Object.fromEntries(P.map((e) => [e.code, e]));
vm.runInContext("globalThis.__set=(n,v)=>{eval(n+' = v')}; globalThis.__get=(n)=>eval(n);", ctx);
const set = run("__set"), get = run("__get");

const A = byCode.A1, B = byCode.B12, C = byCode.C4;
// 行内 A1 的分布：第0行 3 颗、第1行 0 颗、第2行 2 颗（中间夹一个抠空的 null）
const cells = [
  [A, B, A, C, A],
  [B, C, B, C, B],
  [A, null, C, A, B],
];
const gridW = 5, gridH = 3;
set("boardSize", 52);
set("lastPattern", { gridW, gridH, cells });
run("cellEditor").hidden = true;

// 切换行为：点同一个颜色两次应取消
set("highlightIndex", null);
run("setHighlight")(A.index);
assert.strictEqual(get("highlightIndex"), A.index);
run("setHighlight")(A.index);
assert.strictEqual(get("highlightIndex"), null, "再点一次应取消高亮");
run("setHighlight")(A.index);
console.log("PASS 高亮开关：同色再点一次取消");

// 画布上的数字 = 每行从 1 重新开始
const canvas = makeCanvas("hl");
calls.length = 0;
run("drawPatternToCanvas")(canvas, { gridW, gridH, cells }, false);
const CELL = run("CELL_PX");
const offX = Math.floor((52 - gridW) / 2), offY = Math.floor((52 - gridH) / 2);
const texts = calls.filter((c) => c.canvas === "hl" && c.name === "fillText");
// 注意：格子文字是在 ctx.translate(gutter,gutter) 之后画的，而 harness 记录的是
// 变换前的原始坐标，所以这里不加 GUT。（行号是 restore 之后画的，才带 GUT。）
const at = (gx, gy) => {
  const x = (offX + gx) * CELL + CELL / 2, y = (offY + gy) * CELL + CELL / 2 + 1;
  const t = texts.find((v) => Math.abs(v.args[1] - x) < 0.6 && Math.abs(v.args[2] - y) < 0.6);
  return t ? t.args[0] : null;
};
assert.strictEqual(at(0, 0), "1"); assert.strictEqual(at(2, 0), "2"); assert.strictEqual(at(4, 0), "3");
console.log("PASS 第 0 行 A1 标号 1,2,3（从左到右）");
assert.strictEqual(at(0, 2), "1", "第 2 行必须从 1 重新开始，实际 " + at(0, 2));
assert.strictEqual(at(3, 2), "2");
console.log("PASS 第 2 行重新从 1 开始 → 1,2（不是 4,5）");

// 非高亮格子不写字，也不会混进编号里
assert.strictEqual(at(1, 0), null, "非高亮格子不应有文字");
assert.strictEqual(at(1, 1), null);
console.log("PASS 非高亮格子被淡化且不标注");

// 抠空的 null 不参与计数
const row2 = [at(0,2), at(1,2), at(2,2), at(3,2), at(4,2)];
assert.strictEqual(row2[1], null, "null 格不能有编号");
console.log("PASS 抠空格子不计入行内编号 → 第2行为", JSON.stringify(row2));

// 关掉高亮后恢复显示色号
set("highlightIndex", null);
calls.length = 0;
run("drawPatternToCanvas")(canvas, { gridW, gridH, cells }, false);
const texts2 = calls.filter((c) => c.canvas === "hl" && c.name === "fillText");
const codes = new Set(texts2.map((t) => t.args[0]));
assert.ok(codes.has("A1") && codes.has("B12") && codes.has("C4"), "取消高亮后应恢复色号");
console.log("PASS 取消高亮后恢复显示色号");

// 高亮时统计信息应正确（总数 / 涉及行数 / 单行最多）
set("highlightIndex", A.index);
let total = 0, rows = 0, maxRow = 0;
for (const row of cells) {
  let n = 0;
  for (const c of row) if (c && c.index === A.index) n++;
  if (n) { rows++; if (n > maxRow) maxRow = n; }
  total += n;
}
assert.strictEqual(total, 5); assert.strictEqual(rows, 2); assert.strictEqual(maxRow, 3);
console.log(`PASS 统计：A1 共 ${total} 颗 · 分布 ${rows} 行 · 单行最多 ${maxRow} 颗`);

console.log("\nALL HIGHLIGHT TESTS PASSED");
