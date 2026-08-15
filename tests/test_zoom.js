const { ctx, vm } = require("./harness.js");
const assert = require("assert");
const run = (c) => vm.runInContext(c, ctx);
vm.runInContext("globalThis.__set = (n,v)=>{eval(n+' = v')}; globalThis.__get = (n)=>eval(n);", ctx);
const set = run("__set"), get = run("__get");

const wrap = get("editorPatternWrap");
const canvas = get("editorPatternCanvas");
wrap.clientWidth = 640; wrap.clientHeight = 480; wrap.scrollLeft = 0; wrap.scrollTop = 0;
canvas.width = 2058; canvas.height = 2058;

set("editorZoom", null);
run("applyEditorZoom")();
const fit1 = parseFloat(canvas.style.width) / canvas.width;
assert.ok(Math.abs(fit1 - (640 - 4) / 2058) < 1e-6, "适应宽度应按面板宽度算");
console.log("PASS 适应宽度：2058px 画布在 640px 面板下缩放到", (fit1 * 100).toFixed(1) + "%");

canvas.width = 1382; canvas.height = 1382;
run("applyEditorZoom")();
const fit2 = parseFloat(canvas.style.width) / canvas.width;
assert.ok(fit2 > fit1, "换小板子后适应宽度应重新计算，不能沿用旧比例");
console.log("PASS 适应宽度跟随板子尺寸重算 →", (fit2 * 100).toFixed(1) + "%");

const setZoom = run("setEditorZoom");
setZoom(2);
assert.strictEqual(get("editorZoom"), 2);
assert.strictEqual(canvas.style.width, Math.round(1382 * 2) + "px");
console.log("PASS 手动缩放后固定在", get("editorZoom") * 100 + "%，不再自动适应");

setZoom(99); assert.strictEqual(get("editorZoom"), 8, "上限 8x");
setZoom(0.0001); assert.strictEqual(get("editorZoom"), 0.1, "下限 0.1x");
console.log("PASS 缩放范围限制在 0.1x – 8x");

set("editorZoom", 1);
wrap.scrollLeft = 300; wrap.scrollTop = 200;
const anchor = { x: 100, y: 50 };
const contentX = (wrap.scrollLeft + anchor.x) / 1;
const contentY = (wrap.scrollTop + anchor.y) / 1;
setZoom(2, anchor);
const afterX = (wrap.scrollLeft + anchor.x) / 2;
const afterY = (wrap.scrollTop + anchor.y) / 2;
assert.ok(Math.abs(afterX - contentX) < 0.001, `锚点 X 漂移了 ${afterX - contentX}`);
assert.ok(Math.abs(afterY - contentY) < 0.001, `锚点 Y 漂移了 ${afterY - contentY}`);
console.log("PASS 以光标为锚点缩放：放大 2x 后该点仍停在原处");

// no anchor => zoom around the panel centre, also drift-free
set("editorZoom", 1); wrap.scrollLeft = 400; wrap.scrollTop = 300;
const cX = (400 + wrap.clientWidth / 2) / 1;
setZoom(1.25);
assert.ok(Math.abs((wrap.scrollLeft + wrap.clientWidth / 2) / 1.25 - cX) < 0.001, "无锚点时应绕面板中心缩放");
console.log("PASS 按钮缩放绕面板中心，视野不跑偏");

set("editorZoom", null);
run("applyEditorZoom")();
assert.strictEqual(get("editorZoom"), null);
console.log("PASS 回到适应宽度模式");

console.log("\nALL ZOOM TESTS PASSED");
