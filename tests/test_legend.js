// 用豆清单：统计、排序、以及画在图纸下方的版面
const { ctx, vm, calls, makeCanvas } = require("./harness.js");
const assert = require("assert");
const run = (c) => vm.runInContext(c, ctx);
const P = run("MARD_PALETTE");
const byCode = Object.fromEntries(P.map((e) => [e.code, e]));
const CELL_PX = run("CELL_PX"), GUT = run("GUTTER_PX");
const boardPx = (n) => n * CELL_PX + GUT;

run("boardW = boardH = boardSize = 52");
const grid = [
  [byCode.A10, byCode.A9, byCode.B2],
  [byCode.A9,  null,      byCode.A1],
  [byCode.B2,  byCode.B2, byCode.A9],
];
const res = run("countBeads")(grid);
assert.strictEqual(JSON.stringify([...res.sorted.map((s) => s[0])]),
  JSON.stringify(["A1", "A9", "A10", "B2"]), "字母升序 + 数字正序");
assert.strictEqual(res.total, 8);
console.log("PASS 清单排序 A1,A9,A10,B2（A9 在 A10 前）· 合计 8 颗");

const pattern = { gridW: 3, gridH: 3, cells: grid };
const draw = run("drawPatternToCanvas");

const plain = makeCanvas("plain");
draw(plain, pattern, false);
assert.strictEqual(plain.height, boardPx(52), "不带清单时画布 = board + 行号边距");

const withLegend = makeCanvas("withLegend");
draw(withLegend, pattern, true);
assert.strictEqual(withLegend.width, boardPx(52));
assert.ok(withLegend.height > boardPx(52), "清单要额外占高度");
console.log("PASS 画布高度", plain.height, "→", withLegend.height);

const top = boardPx(52);
const texts = calls.filter((c) => c.canvas === "withLegend" && c.name === "fillText" && c.args[2] >= top);
const labels = texts.map((t) => t.args[0]);
for (const [code, { count }] of res.sorted) {
  assert.strictEqual(labels.filter((l) => l === code).length, 1, code + " 应只出现一次");
  assert.ok(labels.includes(count + " 颗"));
}
assert.ok(labels.some((l) => l.includes("共 4 色 / 8 颗")));
assert.ok(Math.max(...texts.map((t) => t.args[2])) < withLegend.height, "清单不能画出画布外");
console.log("PASS 清单内容完整且不溢出画布");

for (const size of [52, 78, 104]) {
  run("boardW = boardH = boardSize = " + size);
  const many = P.slice(0, 221);
  const cells = [many.slice(0, 111), many.slice(111)];
  const c = makeCanvas("big" + size);
  draw(c, { gridW: cells[0].length, gridH: 2, cells }, true);
  const t = calls.filter((x) => x.canvas === "big" + size && x.name === "fillText" && x.args[2] >= boardPx(size));
  assert.ok(Math.max(...t.map((v) => v.args[2])) < c.height, size + ": 行数放得下");
  assert.ok(Math.max(...t.map((v) => v.args[1])) < c.width, size + ": 列数放得下");
  console.log(`PASS 221 色清单在 ${size} 板上排得下（占高 ${c.height - boardPx(size)}px）`);
}
console.log("\nALL LEGEND TESTS PASSED");
