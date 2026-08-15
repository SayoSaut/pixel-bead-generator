// 选区：Shift 累加/加减单格、任意形状、上色、描边
const { ctx, vm, calls, makeCanvas } = require("./harness.js");
const assert = require("assert");
const run = (c) => vm.runInContext(c, ctx);
const P = run("MARD_PALETTE");
const byCode = Object.fromEntries(P.map((e) => [e.code, e]));
vm.runInContext("globalThis.__set=(n,v)=>{eval(n+' = v')}; globalThis.__get=(n)=>eval(n);", ctx);
const set = run("__set");

run("boardSize = 52");
const gridW = 6, gridH = 5;
const cells = Array.from({ length: gridH }, () => Array.from({ length: gridW }, () => byCode.A1));
set("lastPattern", { gridW, gridH, cells });

const key = run("cellKey"), bounds = run("selectionBounds"), dragSelection = run("dragSelection");

set("editorSelection", new Set([key(5, 4)]));
set("selectDrag", { anchor: { gx: 1, gy: 1 }, cur: { gx: 3, gy: 2 }, base: new Set(), additive: false, moved: true });
let s = dragSelection();
assert.strictEqual(s.size, 6);
assert.ok(!s.has(key(5, 4)), "普通拖拽应替换旧选区");
console.log("PASS 普通拖拽：替换选区，3×2 = 6 格");

set("selectDrag", { anchor: { gx: 1, gy: 1 }, cur: { gx: 2, gy: 1 },
  base: new Set([key(5, 4), key(0, 0)]), additive: true, moved: true });
s = dragSelection();
assert.strictEqual(s.size, 4);
assert.ok(s.has(key(5, 4)) && s.has(key(0, 0)) && s.has(key(1, 1)) && s.has(key(2, 1)));
console.log("PASS Shift+拖拽：累加到已有选区 = 4 格");

set("selectDrag", { anchor: { gx: 5, gy: 4 }, cur: { gx: 5, gy: 4 },
  base: new Set([key(5, 4), key(0, 0)]), additive: true, moved: false });
s = dragSelection();
assert.ok(!s.has(key(5, 4)) && s.has(key(0, 0)));
console.log("PASS Shift+点击：已选中的格子被取消");

set("selectDrag", { anchor: { gx: 4, gy: 4 }, cur: { gx: 4, gy: 4 },
  base: new Set([key(0, 0)]), additive: true, moved: false });
s = dragSelection();
assert.ok(s.has(key(4, 4)) && s.size === 2);
console.log("PASS Shift+点击：未选中的格子被加入");

const b = bounds(new Set([key(1, 1), key(4, 3), key(2, 0)]));
assert.strictEqual(JSON.stringify({ ...b }), JSON.stringify({ gx0: 1, gy0: 0, gx1: 5, gy1: 4 }));
assert.strictEqual(bounds(new Set()), null);
console.log("PASS selectionBounds：离散选区包围盒", JSON.stringify({ ...b }));

set("selectDrag", null);
set("editorSelection", new Set([key(0, 0), key(3, 2), key(5, 4)]));
run("applyColorToSelection")(byCode.B12);
const changed = [];
for (let y = 0; y < gridH; y++) for (let x = 0; x < gridW; x++) if (cells[y][x] && cells[y][x].code !== "A1") changed.push(`${x},${y}`);
assert.strictEqual(changed.join(" "), "0,0 3,2 5,4");
console.log("PASS 上色：只改选中的 3 个离散格子 →", changed.join(" "));

set("editorSelection", new Set([key(0, 0)]));
run("applyColorToSelection")(null);
assert.strictEqual(cells[0][0], null);
console.log("PASS 不放豆：选中格子清空为 null");

const canvas = makeCanvas("ov");
run("drawPatternToCanvas")(canvas, { gridW, gridH, cells }, false);
const before = calls.length;
run("drawSelectionOverlay")(canvas, new Set([key(1, 1), key(2, 1)]));
const seg = calls.slice(before).filter((c) => c.name === "moveTo").length;
assert.strictEqual(seg, 6, "2 格相邻应只描 6 条外边，实际 " + seg);
console.log("PASS 选区描边：只描外轮廓，内部边不画");
console.log("\nALL SELECTION TESTS PASSED");
