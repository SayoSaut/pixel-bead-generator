// 抖动：只在平坦区穿插，边界一律单色（型不能被拆散）
const { ctx, vm } = require("./harness.js");
const assert = require("assert");
const run = (c) => vm.runInContext(c, ctx);
const P = run("MARD_PALETTE");
vm.runInContext("globalThis.__set=(n,v)=>{eval(n+' = v')};", ctx);
run("__set")("boardW", 52); run("__set")("boardH", 52); run("__set")("boardSize", 52);

const pal = ["A1", "H2", "H7", "C20", "C24"].map((c) => P.find((e) => e.code === c));

// findDitherPair 应该挑出能"夹住"目标色的一对
const white = P.find((e) => e.code === "H2"), black = P.find((e) => e.code === "H7");
const mid = [(white.lab[0] + black.lab[0]) / 2, 0, 0];
const pair = run("findDitherPair")(mid, [white, black]);
assert.ok((pair.a.code === "H2" && pair.b.code === "H7") || (pair.a.code === "H7" && pair.b.code === "H2"));
assert.ok(pair.t > 0.2 && pair.t < 0.8, "中间灰的混合比例应落在中段，实际 " + pair.t.toFixed(2));
console.log(`PASS findDitherPair：黑白之间的中灰 → ${pair.a.code}/${pair.b.code} 混合比 ${pair.t.toFixed(2)}`);

// 造两块测试图：左半是平坦的中灰（该抖），右半是黑白硬边（不该抖）
function makeImage(W, H, fn) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4, v = fn(x, y);
    data[o] = v; data[o + 1] = v; data[o + 2] = v; data[o + 3] = 255;
  }
  return { width: W, height: H, data };
}
const W = 64, H = 64;
const flat = makeImage(W, H, () => 128);                       // 全图平坦中灰
const edge = makeImage(W, H, (x) => (x < W / 2 ? 0 : 255));    // 正中一条硬边

const idx = new Int16Array(W * H);
const opts = (d) => ({ data: null, palette: [white, black], dither: d });

// 平坦区：开抖动后应出现两种颜色交替
let cells = run("blockModeQuantize")(idx, W, H, 16, 16, null, { ...opts(0.8), data: flat.data });
let codes = new Set(cells.flat().filter(Boolean).map((c) => c.code));
console.log(`平坦中灰 + 抖动 → 用了 ${codes.size} 种色：${[...codes].join(",")}`);
assert.strictEqual(codes.size, 2, "平坦的中间色应该被两色穿插表现");
console.log("PASS 平坦区：中间色用两色穿插表现，而不是硬倒向一边");

// 同一块图关掉抖动应只剩一种色
cells = run("blockModeQuantize")(idx, W, H, 16, 16, null, { ...opts(0), data: flat.data });
codes = new Set(cells.flat().filter(Boolean).map((c) => c.code));
assert.strictEqual(codes.size, 1, "关掉抖动应回到单色大块");
console.log("PASS 关掉抖动：同一块图回到单色");

// 硬边：抖动开着也不能在边界格掺色，否则型会被拆散
cells = run("blockModeQuantize")(idx, W, H, 16, 16, null, { ...opts(0.8), data: edge.data });
for (let gy = 0; gy < 16; gy++) {
  const rowCodes = cells[gy].map((c) => c.code);
  const left = new Set(rowCodes.slice(0, 8)), right = new Set(rowCodes.slice(8));
  assert.strictEqual(left.size, 1, `第 ${gy} 行左半应是纯色，实际 ${[...left]}`);
  assert.strictEqual(right.size, 1, `第 ${gy} 行右半应是纯色，实际 ${[...right]}`);
  assert.notStrictEqual([...left][0], [...right][0], "边界两侧必须是不同的颜色");
}
console.log("PASS 硬边：边界两侧各自纯色、界限干净，抖动没有拆散轮廓");

// 覆盖率加权：一格里 70% 黑 30% 白，应偏向黑（而不是靠投票决定）
const cover = makeImage(8, 8, (x, y) => (y < 5.6 ? 0 : 255));
const one = run("blockModeQuantize")(new Int16Array(64), 8, 8, 1, 1, null, { data: cover.data, palette: [white, black], dither: 0 });
assert.strictEqual(one[0][0].code, "H7", "70% 黑的格子应判为黑");
console.log("PASS 覆盖率加权：格内 70% 黑 → 该格判为黑");

console.log("\nALL DITHER TESTS PASSED");

// --- 纹理 / 形体判别 ---
{
  const W = 96, H = 96, GW = 12, GH = 12;
  function img(fn) {
    const d = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4, v = fn(x, y);
      d[o] = v; d[o + 1] = v; d[o + 2] = v; d[o + 3] = 255;
    }
    return d;
  }
  let sd = 7;
  const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  const tm = (data) => run("computeTextureMap")(data, W, H, GW, GH).texture;
  const mean = (m) => [...m].reduce((a, b) => a + b, 0) / m.length;

  // 平坦：一片纯色
  const flatT = mean(tm(img(() => 128)));
  // 边缘：一条干净的斜边 —— 梯度方向高度一致
  const edgeT = mean(tm(img((x, y) => (x + y < W ? 40 : 210))));
  // 纹理：各向同性的随机噪点
  const texT = mean(tm(img(() => 80 + rnd() * 120)));

  console.log(`平坦 ${flatT.toFixed(2)} | 边缘 ${edgeT.toFixed(2)} | 纹理 ${texT.toFixed(2)}`);
  assert.ok(texT > edgeT * 2, `纹理应明显高于边缘：${texT.toFixed(2)} vs ${edgeT.toFixed(2)}`);
  assert.ok(texT > flatT * 2, "纹理应明显高于平坦区");
  console.log("PASS 结构张量：纹理 >> 边缘、平坦区（靠梯度方向一致性区分，而非梯度大小）");

  // 同样强度的梯度，方向一致的判为边、方向杂乱的判为纹理 —— 这才是关键
  assert.ok(edgeT < 0.5, `干净斜边不该被当成纹理，实际 ${edgeT.toFixed(2)}`);
  console.log("PASS 干净斜边的梯度很强，但因方向一致而不被判为纹理");
}

console.log("\nALL DITHER + TEXTURE TESTS PASSED");
