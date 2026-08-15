const fileInput = document.getElementById("file-input");
const resetCropBtn = document.getElementById("reset-crop");
const cropInfo = document.getElementById("crop-info");
const boardOptions = document.getElementById("board-options");
const fillSlider = document.getElementById("fill-slider");
const fillValue = document.getElementById("fill-value");
const allowRectCheckbox = document.getElementById("allow-rect");
const resultInfo = document.getElementById("result-info");
const sourceCanvas = document.getElementById("source-canvas");
const patternCanvas = document.getElementById("pattern-canvas");
const usageTableBody = document.querySelector("#usage-table tbody");
const exportPngBtn = document.getElementById("export-png");
const exportCsvBtn = document.getElementById("export-csv");

const CELL_PX = 26;          // large enough to fit a color-code label per bead
const BOARD_UNIT = 26;       // one physical Mard board = 26x26 pegs; 52/78/104 = 2/3/4 boards
const HANDLE_R = 6;          // crop-handle hit radius, in canvas px
const MIN_CROP_PX = 20;      // minimum crop-box size, in original image px

let sourceImage = null;
let sourceFullResCtx = null; // full-resolution offscreen 2D context for the current sourceImage, used by the editor eyedropper
let displayScale = 1;        // sourceCanvas px per original-image px
let cropRect = null;         // {x, y, w, h} in ORIGINAL image pixel coords — the overall render region
// 板子不再假定是正方形：很多人手上的成品比例就不是 1:1（40×35 之类）。
// boardSize 保留为"较长边"，仅用于超采样判断等与形状无关的地方。
let boardW = 78, boardH = 78;
let boardSize = 78;
let lastPattern = null;      // { gridW, gridH, cells: [[paletteEntry]] }
let drag = null;             // { target: 'crop', mode, startOrig:{x,y}, startRect:{...} }
let zoomLevel = 1;
let lastZoomedBoardSize = null;

const patternWrap = document.querySelector(".pattern-wrap");
const zoomInBtn = document.getElementById("zoom-in");
const zoomOutBtn = document.getElementById("zoom-out");
const zoomFitBtn = document.getElementById("zoom-fit");
const zoomLabel = document.getElementById("zoom-label");
const cutoutEnabledCheckbox = document.getElementById("cutout-enabled");
const cutoutToleranceSlider = document.getElementById("cutout-tolerance");
const cutoutToleranceValue = document.getElementById("cutout-tolerance-value");

// Quadratic ease-in: most of the slider's travel covers the low end, where
// small differences in tolerance matter most for separating a subject from
// its background; the last stretch covers a much wider absolute range for
// the "just flood everything" end, without needing that many fine steps
// there.
function toleranceFromSlider(v) {
  return Math.round((v / 100) ** 2 * 150 * 10) / 10;
}
cutoutToleranceValue.textContent = toleranceFromSlider(parseFloat(cutoutToleranceSlider.value));
cutoutToleranceSlider.addEventListener("input", () => {
  cutoutToleranceValue.textContent = toleranceFromSlider(parseFloat(cutoutToleranceSlider.value));
  regenerate();
});

let cutoutMode = "color"; // "color" | "ml" | "general"
const cutoutColorControls = document.getElementById("cutout-color-controls");
const cutoutDetail = document.getElementById("cutout-detail");
const mlStatusBox = document.getElementById("ml-status");

// The mode buttons and tolerance slider are meaningless while cutout is off,
// so the whole block stays collapsed until the switch is on.
cutoutEnabledCheckbox.addEventListener("change", () => {
  cutoutDetail.hidden = !cutoutEnabledCheckbox.checked;
  regenerate();
});

function setMlStatus(text) {
  mlStatusBox.textContent = text || "";
  mlStatusBox.hidden = !text;
}

document.querySelectorAll(".cutout-mode-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    cutoutMode = btn.dataset.mode;
    document.querySelectorAll(".cutout-mode-btn").forEach((b) => b.classList.toggle("active", b === btn));
    cutoutColorControls.hidden = cutoutMode !== "color";
    if (cutoutMode === "color") setMlStatus("");
    if (cutoutMode === "ml") setMlStatus("首次使用需从网络加载分割模型（几 MB），之后会缓存");
    if (cutoutMode === "general") setMlStatus("首次使用需从网络加载通用物体分割模型（约 40MB），之后会缓存");
    regenerate();
  });
});

// ---------- ML person/subject segmentation (lazy-loaded) ----------
// A completely different mechanism from the color flood-fill: this asks a
// real segmentation model "which pixels are a person," instead of "which
// pixels are connected to the border by similar color." That's what lets it
// handle busy photo backgrounds the flood fill can't — but it only knows
// people, not arbitrary objects (a product shot, a mascot, an animal will
// not be reliably segmented).
let mlSegmenterPromise = null;
function getMlSegmenter() {
  if (mlSegmenterPromise) return mlSegmenterPromise;
  mlSegmenterPromise = new Promise((resolve, reject) => {
    if (typeof SelfieSegmentation === "undefined") {
      reject(new Error("ML 模型脚本未能加载（可能没有联网）"));
      return;
    }
    const seg = new SelfieSegmentation({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1/${file}`,
    });
    seg.setOptions({ modelSelection: 1 });
    seg.onResults((results) => {
      if (seg._resolveOnce) {
        const r = seg._resolveOnce;
        seg._resolveOnce = null;
        r(results);
      }
    });
    resolve(seg);
  });
  return mlSegmenterPromise;
}

async function computeMlForegroundMask(img, crop, allowRect, dw, dh) {
  const seg = await getMlSegmenter();
  const inputCanvas = document.createElement("canvas");
  inputCanvas.width = dw;
  inputCanvas.height = dh;
  const ictx = inputCanvas.getContext("2d");
  let { x: sx, y: sy, w: sw, h: sh } = crop;
  if (!allowRect) {
    const side = Math.min(sw, sh);
    sx = sx + (sw - side) / 2;
    sy = sy + (sh - side) / 2;
    sw = side;
    sh = side;
  }
  ictx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);

  const results = await new Promise((resolve, reject) => {
    seg._resolveOnce = resolve;
    seg.send({ image: inputCanvas }).catch(reject);
  });

  const mctx = document.createElement("canvas").getContext("2d");
  mctx.canvas.width = dw;
  mctx.canvas.height = dh;
  mctx.drawImage(results.segmentationMask, 0, 0, dw, dh);
  const maskData = mctx.getImageData(0, 0, dw, dh).data;

  // segmentationMask is a grayscale confidence map (person = bright);
  // invert it into the same "true = background" convention bgMask uses.
  const bg = new Uint8Array(dw * dh);
  for (let p = 0; p < dw * dh; p++) bg[p] = maskData[p * 4] < 128 ? 1 : 0;
  return bg;
}

// ---------- ML general/salient-object segmentation (lazy-loaded) ----------
// Unlike the person-only model above, this asks "what's the single most
// salient subject in this image," with no fixed category — it's what's
// needed for a mascot/product/animal on a busy background, which the
// person model won't recognize and the color flood-fill can't separate
// from a non-uniform backdrop. The tradeoff is size: this model is tens of
// MB versus a few MB for the person one, downloaded once and cached.
// The library's actual model/wasm weights (tens of MB) don't ship in the
// small JS npm package at all — they live in a separate
// @imgly/background-removal-data package that IMG.LY mirrors on their own
// CDN, versioned to match. The library defaults `publicPath` to exactly
// this URL (with the version filled in via its own package.json) — but
// that substitution reads its own import.meta info, which breaks when the
// module is loaded through jsdelivr's "+esm" transform (needed below just
// to resolve the library's own bare imports like "ndarray" — a browser
// can't do that natively). So `publicPath` has to be passed explicitly to
// bypass the broken default.
const GENERAL_BG_REMOVAL_VERSION = "1.5.5";
const GENERAL_BG_REMOVAL_PUBLIC_PATH = `https://staticimgly.com/@imgly/background-removal-data/${GENERAL_BG_REMOVAL_VERSION}/dist/`;
let generalRemoveBackgroundPromise = null;
function getGeneralRemoveBackground() {
  if (generalRemoveBackgroundPromise) return generalRemoveBackgroundPromise;
  generalRemoveBackgroundPromise = import(
    `https://cdn.jsdelivr.net/npm/@imgly/background-removal@${GENERAL_BG_REMOVAL_VERSION}/+esm`
  ).then((mod) => mod.removeBackground);
  return generalRemoveBackgroundPromise;
}

async function computeGeneralForegroundMask(img, crop, allowRect, dw, dh) {
  const removeBackground = await getGeneralRemoveBackground();
  const inputCanvas = document.createElement("canvas");
  inputCanvas.width = dw;
  inputCanvas.height = dh;
  const ictx = inputCanvas.getContext("2d");
  let { x: sx, y: sy, w: sw, h: sh } = crop;
  if (!allowRect) {
    const side = Math.min(sw, sh);
    sx = sx + (sw - side) / 2;
    sy = sy + (sh - side) / 2;
    sw = side;
    sh = side;
  }
  ictx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);

  const inputBlob = await new Promise((resolve) => inputCanvas.toBlob(resolve, "image/png"));
  const resultBlob = await removeBackground(inputBlob, {
    model: "small",
    output: { format: "image/png" },
    publicPath: GENERAL_BG_REMOVAL_PUBLIC_PATH,
  });
  const resultBitmap = await createImageBitmap(resultBlob);
  const mctx = document.createElement("canvas").getContext("2d");
  mctx.canvas.width = dw;
  mctx.canvas.height = dh;
  mctx.drawImage(resultBitmap, 0, 0, dw, dh);
  const maskData = mctx.getImageData(0, 0, dw, dh).data;

  // The result PNG carries the subject's alpha channel; anything
  // transparent is background, in the same "true = background" convention
  // bgMask uses elsewhere.
  const bg = new Uint8Array(dw * dh);
  for (let p = 0; p < dw * dh; p++) bg[p] = maskData[p * 4 + 3] < 128 ? 1 : 0;
  return bg;
}

// ---------- Image loading ----------

const fileNameLabel = document.getElementById("file-name");
const sourceEmpty = document.getElementById("source-empty");

fileInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  fileNameLabel.textContent = file.name;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      sourceImage = img;
      if (sourceEmpty) sourceEmpty.hidden = true;
      buildSourceFullResCanvas(img);
      sizeSourceCanvas(img);
      cropRect = fullImageCrop(img);
      renderSourceWithCrop();
      regenerate();
    };
    img.onerror = () => {
      fileNameLabel.textContent = "这个文件读不出来，换一张试试";
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
});

resetCropBtn.addEventListener("click", () => {
  if (!sourceImage) return;
  cropRect = fullImageCrop(sourceImage);
  renderSourceWithCrop();
  regenerate();
});

// The crop box starts as the whole image and is only ever moved by hand.
// An earlier version tried to auto-detect the subject and pre-frame it, but a
// guess that lands even slightly wrong is more annoying to correct than just
// dragging the box yourself — and when it was right, it was still a surprise.
function fullImageCrop(img) {
  return { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
}

// Cached once per uploaded image so the editor's eyedropper can sample an
// exact pixel without redrawing the (possibly large) source image on every
// click.
function buildSourceFullResCanvas(img) {
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  sourceFullResCtx = canvas.getContext("2d");
  sourceFullResCtx.drawImage(img, 0, 0);
}

function sizeSourceCanvas(img) {
  const maxW = Math.min(720, (sourceCanvas.parentElement.clientWidth || 400) - 4);
  // Upscale small source images for display too (capped at 6x) — a lot of
  // card/sticker art is downloaded at a small native size, and capping the
  // preview at 1:1 would leave the crop box too tiny to drag precisely.
  displayScale = Math.min(6, maxW / img.naturalWidth);
  sourceCanvas.width = Math.round(img.naturalWidth * displayScale);
  sourceCanvas.height = Math.round(img.naturalHeight * displayScale);
}

// ---------- Crop overlay rendering + drag interaction ----------

function renderSourceWithCrop() {
  const ctx = sourceCanvas.getContext("2d");
  ctx.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);
  ctx.drawImage(sourceImage, 0, 0, sourceCanvas.width, sourceCanvas.height);
  if (!cropRect) return;

  const cx = cropRect.x * displayScale, cy = cropRect.y * displayScale;
  const cw = cropRect.w * displayScale, ch = cropRect.h * displayScale;

  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(0, 0, sourceCanvas.width, cy); // top
  ctx.fillRect(0, cy + ch, sourceCanvas.width, sourceCanvas.height - cy - ch); // bottom
  ctx.fillRect(0, cy, cx, ch); // left
  ctx.fillRect(cx + cw, cy, sourceCanvas.width - cx - cw, ch); // right

  drawRectWithHandles(ctx, cx, cy, cw, ch, "#e8590c");
  if (cropInfo) {
    const w = Math.round(cropRect.w), h = Math.round(cropRect.h);
    cropInfo.textContent = `裁剪 ${w}×${h}px · 比例 ${(w / h).toFixed(2)}:1`;
  }
}

function drawRectWithHandles(ctx, x, y, w, h, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = "#ffffff";
  for (const [hx, hy] of cornerPoints(x, y, w, h)) {
    ctx.beginPath();
    ctx.arc(hx, hy, HANDLE_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

function cornerPoints(cx, cy, cw, ch) {
  return [[cx, cy], [cx + cw, cy], [cx, cy + ch], [cx + cw, cy + ch]];
}

function canvasCoords(evt) {
  const rect = sourceCanvas.getBoundingClientRect();
  return {
    x: ((evt.clientX - rect.left) * sourceCanvas.width) / rect.width,
    y: ((evt.clientY - rect.top) * sourceCanvas.height) / rect.height,
  };
}

function hitTestRect(rect, x, y) {
  if (!rect) return null;
  const cx = rect.x * displayScale, cy = rect.y * displayScale;
  const cw = rect.w * displayScale, ch = rect.h * displayScale;
  const corners = { nw: [cx, cy], ne: [cx + cw, cy], sw: [cx, cy + ch], se: [cx + cw, cy + ch] };
  for (const [name, [hx, hy]] of Object.entries(corners)) {
    if (Math.hypot(x - hx, y - hy) <= HANDLE_R + 4) return name;
  }
  if (x >= cx && x <= cx + cw && y >= cy && y <= cy + ch) return "move";
  return null;
}

sourceCanvas.addEventListener("mousedown", (evt) => {
  if (!sourceImage) return;
  const { x, y } = canvasCoords(evt);
  const cropMode = hitTestRect(cropRect, x, y);
  if (cropMode) {
    drag = { target: "crop", mode: cropMode, startOrig: { x: x / displayScale, y: y / displayScale }, startRect: { ...cropRect } };
  }
});

window.addEventListener("mousemove", (evt) => {
  if (!drag || !sourceImage) return;
  const { x, y } = canvasCoords(evt);
  const mx = Math.max(0, Math.min(sourceImage.naturalWidth, x / displayScale));
  const my = Math.max(0, Math.min(sourceImage.naturalHeight, y / displayScale));
  const r0 = drag.startRect;
  let next;

  if (drag.mode === "move") {
    const dx = mx - drag.startOrig.x, dy = my - drag.startOrig.y;
    const nx = clamp(r0.x + dx, 0, sourceImage.naturalWidth - r0.w);
    const ny = clamp(r0.y + dy, 0, sourceImage.naturalHeight - r0.h);
    next = { x: nx, y: ny, w: r0.w, h: r0.h };
  } else {
    const fixed = {
      nw: [r0.x + r0.w, r0.y + r0.h],
      ne: [r0.x, r0.y + r0.h],
      sw: [r0.x + r0.w, r0.y],
      se: [r0.x, r0.y],
    }[drag.mode];
    const [fx, fy] = fixed;
    // x/y = top-left of the box spanned by the dragged corner and the fixed
    // opposite corner, regardless of which direction the drag goes.
    next = {
      x: Math.min(mx, fx),
      y: Math.min(my, fy),
      w: Math.max(MIN_CROP_PX, Math.abs(mx - fx)),
      h: Math.max(MIN_CROP_PX, Math.abs(my - fy)),
    };
  }

  cropRect = next;
  renderSourceWithCrop();
});

window.addEventListener("mouseup", () => {
  if (!drag) return;
  drag = null;
  renderSourceWithCrop();
  regenerate();
});

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// ---------- Controls ----------

// 板子尺寸不再限定于 52/78/104 —— 那三个是标准拼豆板的整数倍，但很多人
// 就是习惯拼 40×40 这样的尺寸，或者手上的板子本来就拼不出整数倍。
const MIN_BOARD = 16, MAX_BOARD = 160;
const customWInput = document.getElementById("custom-size-w");
const customHInput = document.getElementById("custom-size-h");

function setBoard(w, h) {
  boardW = clamp(Math.round(Number(w) || 0), MIN_BOARD, MAX_BOARD);
  boardH = clamp(Math.round(Number(h) || boardW), MIN_BOARD, MAX_BOARD);
  boardSize = Math.max(boardW, boardH);
  const isPreset = boardW === boardH && [52, 78, 104].includes(boardW);
  [...boardOptions.children].forEach((b) =>
    b.classList.toggle("active", isPreset && parseInt(b.dataset.size, 10) === boardW)
  );
  if (customWInput) customWInput.value = isPreset ? "" : boardW;
  if (customHInput) customHInput.value = isPreset ? "" : boardH;
  regenerate();
}
function setBoardSize(n) { setBoard(n, n); }

boardOptions.addEventListener("click", (e) => {
  const btn = e.target.closest(".seg-btn");
  if (!btn) return;
  setBoardSize(btn.dataset.size);
});
[...boardOptions.children].forEach((b) => {
  if (parseInt(b.dataset.size, 10) === boardSize) b.classList.add("active");
});

function applyCustomBoard() {
  // 只填了一个就当正方形 —— 想要 40×40 不必把 40 打两遍。
  const w = Number(customWInput.value) || Number(customHInput.value);
  const h = Number(customHInput.value) || Number(customWInput.value);
  if (w && h) setBoard(w, h);
}
bindIfPresent("custom-size-apply", "click", applyCustomBoard);
for (const input of [customWInput, customHInput]) {
  if (!input) continue;
  input.addEventListener("keydown", (evt) => {
    if (evt.key === "Enter") { evt.preventDefault(); applyCustomBoard(); }
  });
}

// ---------- Detail & color compensation ----------
// Two knobs for the same underlying problem: shrinking an image to a few
// thousand cells averages away exactly what made it readable.
//
// Sharpening (unsharp mask) fights the loss of EDGES. Averaging a 7x7 patch
// softens every boundary, and once a boundary spans two cells at half
// strength each, quantization rounds both to the same bead and the edge is
// gone. Boosting local contrast before the averaging means the edge survives
// as a real difference between neighbouring cells.
//
// Vividness fights the loss of COLOR, and it is not a beautification hack:
// on broken-brushwork painting (Impressionism especially) the eye optically
// mixes adjacent strokes into a colour more saturated than their physical
// average. The maths only ever computes the average, so a Monet sky that
// reads as blue measures as grey. Raising chroma before matching restores
// what a viewer actually sees.
const sharpenSlider = document.getElementById("sharpen-slider");
const sharpenValue = document.getElementById("sharpen-value");
const vividSlider = document.getElementById("vivid-slider");
const vividValue = document.getElementById("vivid-value");

// radius 决定"多大范围算一个区块"，passes 决定压得多死，sharpen 是压平之后
// 补的一点边界强调。
const STRUCTURE_STEPS = [
  { label: "关闭",  radius: 0, passes: 0, sharpen: 0 },
  { label: "轻微",  radius: 1, passes: 1, sharpen: 0.2 },
  { label: "适中",  radius: 2, passes: 1, sharpen: 0.35 },
  { label: "较强",  radius: 2, passes: 2, sharpen: 0.5 },
  { label: "最强",  radius: 3, passes: 2, sharpen: 0.6 },
];

function structureSetting() {
  return STRUCTURE_STEPS[parseInt(sharpenSlider.value, 10)] || STRUCTURE_STEPS[0];
}
function vividAmount() {
  return (parseInt(vividSlider.value, 10) || 100) / 100;
}
function syncDetailLabels() {
  sharpenValue.textContent = structureSetting().label;
  const v = vividAmount();
  vividValue.textContent = v <= 1.001 ? "原样" : `×${v.toFixed(1)}`;
}
syncDetailLabels();
sharpenSlider.addEventListener("input", () => { syncDetailLabels(); regenerate(); });
vividSlider.addEventListener("input", () => { syncDetailLabels(); regenerate(); });

// ---------- Kuwahara: 按区块压平，只留边界 ----------
// 一般的锐化（USM）在这里是错的思路：它无差别地放大所有高频，笔触噪点和
// 真正的轮廓一起被放大，结果是更花而不是更清楚。
//
// Kuwahara 反过来做：每个像素看它周围四个重叠的象限，选其中"最均匀"（方差
// 最小）的那个，用它的平均色。位于某个色块内部的像素，四个象限都在同色区
// 里，输出就是那块的平均色 —— 整块被压平；而骑在边界上的像素，跨界的象限
// 方差大会被淘汰，它只会取到边界某一侧的颜色 —— 边界因此不但没被模糊，反而
// 被推向"非此即彼"。
//
// 这正是拼豆需要的：每个区块内部干净成一片，区块之间界限分明。对莫奈那种
// 碎笔触尤其有效 —— 一片由几十种蓝紫笔触组成的天空会被压成几块干净的色区，
// 而不是继续在相邻格子间反复横跳。
function kuwahara(data, W, H, radius) {
  const out = new Uint8ClampedArray(data.length);
  const lum = new Float32Array(W * H);
  for (let p = 0; p < W * H; p++) {
    const o = p * 4;
    lum[p] = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
  }
  // 四个象限相对于中心的范围，彼此重叠一行/一列（都含中心像素）
  const quads = [[-radius, 0, -radius, 0], [0, radius, -radius, 0],
                 [-radius, 0, 0, radius], [0, radius, 0, radius]];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let bestVar = Infinity, bR = 0, bG = 0, bB = 0;
      for (const [dx0, dx1, dy0, dy1] of quads) {
        let sum = 0, sumSq = 0, r = 0, g = 0, b = 0, n = 0;
        for (let yy = y + dy0; yy <= y + dy1; yy++) {
          if (yy < 0 || yy >= H) continue;
          for (let xx = x + dx0; xx <= x + dx1; xx++) {
            if (xx < 0 || xx >= W) continue;
            const p = yy * W + xx, o = p * 4;
            const l = lum[p];
            sum += l; sumSq += l * l;
            r += data[o]; g += data[o + 1]; b += data[o + 2]; n++;
          }
        }
        if (!n) continue;
        const variance = sumSq / n - (sum / n) * (sum / n);
        if (variance < bestVar) { bestVar = variance; bR = r / n; bG = g / n; bB = b / n; }
      }
      const o = (y * W + x) * 4;
      out[o] = bR; out[o + 1] = bG; out[o + 2] = bB; out[o + 3] = 255;
    }
  }
  return out;
}

// 结构增强 + 彩度补偿。都在中间图上做，也就是量化之前 —— 之后再做就只能
// 加工已经丢失的信息了。
function enhanceImageData(imageData, structure, vivid) {
  const { width: W, height: H } = imageData;
  let data = imageData.data;

  if (structure && structure.radius > 0) {
    for (let i = 0; i < structure.passes; i++) {
      // 多跑几遍会让区块越来越"死板"：第一遍压平笔触，后面几遍把相邻的
      // 相近色区并成同一块，轮廓也越来越硬。
      data = kuwahara(data, W, H, structure.radius);
    }
    if (structure.sharpen > 0) {
      // 压平之后再做一点点 USM 就安全了 —— 此时高频里已经基本只剩真正的
      // 边界，噪点在上一步被吃掉了。
      const blur = new Float32Array(W * H * 3);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          let r = 0, g = 0, b = 0, n = 0;
          for (let dy = -1; dy <= 1; dy++) {
            const yy = y + dy;
            if (yy < 0 || yy >= H) continue;
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx;
              if (xx < 0 || xx >= W) continue;
              const o = (yy * W + xx) * 4;
              r += data[o]; g += data[o + 1]; b += data[o + 2]; n++;
            }
          }
          const q = (y * W + x) * 3;
          blur[q] = r / n; blur[q + 1] = g / n; blur[q + 2] = b / n;
        }
      }
      const sharp = new Uint8ClampedArray(data);
      for (let p = 0; p < W * H; p++) {
        const o = p * 4, q = p * 3;
        for (let ch = 0; ch < 3; ch++) {
          sharp[o + ch] = data[o + ch] + structure.sharpen * (data[o + ch] - blur[q + ch]);
        }
      }
      data = sharp;
    }
  }

  if (vivid > 1.001) {
    const out = new Uint8ClampedArray(data);
    for (let p = 0; p < W * H; p++) {
      const o = p * 4;
      const r = out[o], g = out[o + 1], b = out[o + 2];
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      out[o] = gray + (r - gray) * vivid;
      out[o + 1] = gray + (g - gray) * vivid;
      out[o + 2] = gray + (b - gray) * vivid;
    }
    data = out;
  }

  return data === imageData.data ? imageData : { width: W, height: H, data };
}

fillSlider.addEventListener("input", () => {
  fillValue.textContent = Math.round(fillSlider.value * 100) + "%";
  regenerate();
});

allowRectCheckbox.addEventListener("change", regenerate);

// ---------- Simplification level ----------
// One slider, because the two knobs behind it are not independently useful:
// "few colors but keep every speck" and "many colors but no small regions"
// both look wrong. Level 0 is the old faithful-reproduction behaviour, kept
// for photos where you genuinely want every shade.
const simplifySlider = document.getElementById("simplify-slider");
const simplifyValue = document.getElementById("simplify-value");

const SIMPLIFY_STEPS = [
  { label: "关闭 · 忠实原图", maxColors: 0,  minRegion: 1, passes: 0, threshold: 9 },
  { label: "轻度 · 去杂色",   maxColors: 40, minRegion: 2, passes: 1, threshold: 6 },
  { label: "中等 · 卡通化",   maxColors: 24, minRegion: 3, passes: 2, threshold: 5 },
  { label: "较强 · 大色块",   maxColors: 16, minRegion: 5, passes: 3, threshold: 5 },
  { label: "最强 · 极简",     maxColors: 10, minRegion: 9, passes: 4, threshold: 4 },
];

function simplifySettings() {
  return SIMPLIFY_STEPS[parseInt(simplifySlider.value, 10)] || SIMPLIFY_STEPS[0];
}

function syncSimplifyLabel() {
  simplifyValue.textContent = simplifySettings().label;
}
syncSimplifyLabel();
simplifySlider.addEventListener("input", () => {
  syncSimplifyLabel();
  regenerate();
});

// ---------- Core pipeline ----------

let regenerateToken = 0;

// async because ML cutout mode has to await a model call; every other code
// path resolves on the same tick as before. A monotonic token guards
// against the user changing a setting again while a previous ML call is
// still in flight — the stale call's result gets discarded instead of
// clobbering whatever the newer one rendered.
async function regenerate() {
  if (!sourceImage || !cropRect) return;
  const myToken = ++regenerateToken;

  const allowRect = allowRectCheckbox.checked;
  const samplesPerCell = 7;
  const fillRatio = parseFloat(fillSlider.value);

  // 小板子直接按自身分辨率量化会让每格可用的原始像素太少 —— 颜色投票变得
  // 嘈杂，抠图模型/泛洪看到的图也小一圈，边缘因此发毛。所以一律先在 2 倍
  // 分辨率上跑完整套，再把每个 2×2 已定色的格子合并下来。
  const SUPERSAMPLE_BELOW = 60;
  const superSample = Math.max(boardW, boardH) < SUPERSAMPLE_BELOW;
  const factor = superSample ? 2 : 1;
  const cap = Math.max(200, Math.max(boardW, boardH) * factor * samplesPerCell);
  const imageData = enhanceImageData(
    prepareIntermediate(sourceImage, cropRect, allowRect, cap),
    structureSetting(),
    vividAmount()
  );
  const { gridW: sourceGridW, gridH: sourceGridH } = computeGrid(imageData.width, imageData.height, boardW * factor, boardH * factor, fillRatio);

  // Simplification level drives BOTH halves of the cartoonify treatment:
  // how many colors the picture may use at all, and how big a patch has to
  // be to survive. They have to move together — cutting colors alone still
  // leaves ragged one-cell borders where two regions meet, and cleaning
  // regions alone can't stop a gradient from being tiled with a dozen
  // near-identical blues in the first place.
  const { maxColors, minRegion, passes, threshold } = simplifySettings();
  const allowedPalette = maxColors ? buildReducedPalette(imageData, maxColors) : null;

  const rawIndices = quantizeIndices(imageData, allowedPalette);
  const indices = despeckleIndices(rawIndices, imageData.width, imageData.height);

  // Cutout has two independent mechanisms behind the same on/off switch:
  // "color" floods inward from the crop's border through runs of
  // locally-similar color (good for clean/uniform backdrops, follows
  // gradients, but has no idea what "the subject" is); "ml" asks a real
  // person-segmentation model instead, which handles busy photo
  // backgrounds the flood fill can't, but only recognizes people.
  const useCutout = cutoutEnabledCheckbox.checked;
  let bgMask = null;
  if (useCutout && cutoutMode === "color") {
    bgMask = computeBackgroundMask(imageData, toleranceFromSlider(parseFloat(cutoutToleranceSlider.value)));
  } else if (useCutout && cutoutMode === "ml") {
    setMlStatus("正在运行 ML 分割…");
    try {
      bgMask = await computeMlForegroundMask(sourceImage, cropRect, allowRect, imageData.width, imageData.height);
      if (myToken !== regenerateToken) return; // a newer regenerate() superseded this one
      setMlStatus("ML 人像分割完成");
    } catch (err) {
      if (myToken !== regenerateToken) return;
      setMlStatus("ML 模型加载/运行失败：" + err.message + "（已跳过抠图，其余部分正常生成）");
      bgMask = null;
    }
  } else if (useCutout && cutoutMode === "general") {
    setMlStatus("正在运行通用物体分割（首次需下载模型，约 40MB）…");
    try {
      bgMask = await computeGeneralForegroundMask(sourceImage, cropRect, allowRect, imageData.width, imageData.height);
      if (myToken !== regenerateToken) return; // a newer regenerate() superseded this one
      setMlStatus("通用物体分割完成");
    } catch (err) {
      if (myToken !== regenerateToken) return;
      setMlStatus("通用物体分割模型加载/运行失败：" + err.message + "（已跳过抠图，其余部分正常生成）");
      bgMask = null;
    }
  }

  const sourceCells = blockModeQuantize(indices, imageData.width, imageData.height, sourceGridW, sourceGridH, bgMask);
  let { gridW, gridH, cells } = superSample
    ? downsampleCellsByHalf(sourceCells, sourceGridW, sourceGridH)
    : { gridW: sourceGridW, gridH: sourceGridH, cells: sourceCells };

  // Both cleanup passes run last, on the grid the user actually gets: the 52
  // board's halving pass creates its own new specks, so cleaning before it
  // would leave them behind. Smoothing goes first — it turns noise fields
  // into solid areas, and whatever single beads it leaves at the edges are
  // exactly what removeSmallRegions is for.
  cells = smoothCellsByMajority(cells, gridW, gridH, passes, threshold);
  cells = removeSmallRegions(cells, gridW, gridH, minRegion);

  // The grid may have changed shape, so cell coordinates held over from a
  // previous selection no longer point at the same beads. The highlighted
  // color may not even exist in the new pattern (a different palette scope
  // or simplification level drops colors entirely), so it goes too.
  editorSelection = new Set();
  highlightIndex = null;
  lastPattern = { gridW, gridH, cells };
  renderPattern(lastPattern);
  renderUsage(lastPattern);
  updateHighlightInfo();

  const shapeKey = `${boardW}x${boardH}`;
  if (shapeKey !== lastZoomedBoardSize) {
    lastZoomedBoardSize = shapeKey;
    setZoom((patternWrap.clientWidth - 4) / patternCanvas.width);
  }

  const { sorted, total } = countBeads(cells);
  renderStats([
    ["板子", `${boardW}×${boardH}`,
      boardW % BOARD_UNIT === 0 && boardH % BOARD_UNIT === 0
        ? `${boardW / BOARD_UNIT}×${boardH / BOARD_UNIT} 块拼板`
        : `约 ${(boardW * 0.5).toFixed(0)}×${(boardH * 0.5).toFixed(0)}cm`],
    ["图案", `${gridW}×${gridH}`, useCutout ? "已抠图" : "格"],
    ["用色", `${sorted.length}`, "种"],
    ["总豆数", `${total}`, "颗"],
  ]);

  exportPngBtn.disabled = false;
  exportCsvBtn.disabled = false;
  const openEditorBtn = document.getElementById("open-editor");
  if (openEditorBtn) openEditorBtn.disabled = false;

  // Note: any manual per-cell edits made in the editor before this
  // regenerate() ran are gone now — this rebuilds `cells` from scratch from
  // the current crop/board/cutout settings, with no memory of prior
  // overrides. That's intentional: the editor is a final polish step, meant
  // to run after upstream settings are already dialed in.
}

function renderStats(rows) {
  resultInfo.innerHTML = rows
    .map(([label, value, unit]) =>
      `<div class="stat"><span class="stat-label">${label}</span>` +
      `<span class="stat-value">${value}</span>` +
      `<span class="stat-unit">${unit}</span></div>`
    )
    .join("");
}

// ---------- Cutout (background removal) ----------
// Classic "magic wand from every edge pixel" region growing: seed from the
// crop's own border, then keep absorbing neighbors whose color is close to
// the CURRENT flood pixel (not one fixed reference color) — that's what
// lets it follow a gradient or soft shadow instead of stopping the instant
// the background isn't perfectly flat. It has no idea what "the subject" is
// semantically; it only knows "connected to the edge via similar colors" —
// so a background that's itself highly varied (a busy texture, multiple
// colors) will leak through as "not background" almost everywhere, and this
// won't separate anything usefully. Works best on a fairly clean/uniform
// (or smoothly gradient) backdrop.
function computeBackgroundMask(imageData, tolerance) {
  const { width: W, height: H, data } = imageData;
  const n = W * H;
  const bg = new Uint8Array(n);
  const stack = [];
  const seed = (i) => { if (!bg[i]) { bg[i] = 1; stack.push(i); } };
  for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1); }

  while (stack.length) {
    const i = stack.pop();
    const o = i * 4;
    const r = data[o], g = data[o + 1], b = data[o + 2];
    const x = i % W, y = (i / W) | 0;
    const neighbors = [];
    if (x > 0) neighbors.push(i - 1);
    if (x < W - 1) neighbors.push(i + 1);
    if (y > 0) neighbors.push(i - W);
    if (y < H - 1) neighbors.push(i + W);
    for (const ni of neighbors) {
      if (bg[ni]) continue;
      const no = ni * 4;
      const dr = r - data[no], dg = g - data[no + 1], db = b - data[no + 2];
      if (Math.sqrt(dr * dr + dg * dg + db * db) <= tolerance) {
        bg[ni] = 1;
        stack.push(ni);
      }
    }
  }
  return bg;
}

// ---------- Zoom controls ----------

function applyZoomStyle() {
  patternCanvas.style.width = Math.round(patternCanvas.width * zoomLevel) + "px";
  patternCanvas.style.height = Math.round(patternCanvas.height * zoomLevel) + "px";
  zoomLabel.textContent = Math.round(zoomLevel * 100) + "%";
}

function setZoom(z) {
  zoomLevel = clamp(z, 0.1, 6);
  applyZoomStyle();
}

zoomInBtn.addEventListener("click", () => setZoom(zoomLevel * 1.25));
zoomOutBtn.addEventListener("click", () => setZoom(zoomLevel / 1.25));
zoomFitBtn.addEventListener("click", () => setZoom((patternWrap.clientWidth - 4) / patternCanvas.width));

// Crop (+ optional center-square crop) then downscale to an EXACT target
// resolution, with NO smoothing so the sampled pixels stay crisp —
// smoothing here would pre-blend fine detail (like eyes) away before we
// ever get a chance to quantize it per-pixel.
function sampleRegion(img, crop, allowRect, dw, dh) {
  let { x: sx, y: sy, w: sw, h: sh } = crop;
  if (!allowRect) {
    const side = Math.min(sw, sh);
    sx = sx + (sw - side) / 2;
    sy = sy + (sh - side) / 2;
    sw = side;
    sh = side;
  }
  const canvas = document.createElement("canvas");
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext("2d");
  // Transparent PNG pixels read back as (0,0,0) with alpha 0 in most
  // browsers, which the rest of the pipeline can't distinguish from real
  // black — composite onto white before sampling.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, dw, dh);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
  return ctx.getImageData(0, 0, dw, dh);
}

// Same as sampleRegion, but sizes the output to preserve the crop's aspect
// ratio (capped at `cap` on the long side) instead of a forced exact size.
function prepareIntermediate(img, crop, allowRect, cap) {
  let { w: sw, h: sh } = crop;
  if (!allowRect) {
    const side = Math.min(sw, sh);
    sw = side;
    sh = side;
  }
  const scale = Math.min(1, cap / Math.max(sw, sh));
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));
  return sampleRegion(img, crop, allowRect, dw, dh);
}

// Remove single-pixel noise WITHOUT eroding real small features. A median
// blur (an earlier version of this) kills speckle from busy backgrounds, but
// it does that by voting down anything a pixel disagrees with its
// neighborhood about — which also erodes genuine 2-3px design details (a
// thin eye-marking outline, a highlight dot) from the edges inward. This
// version only touches pixels that are fully ISOLATED (none of their 8
// quantized neighbors share their color); anything that's part of even a
// 2-pixel-connected patch is left completely alone. Runs on the already
// palette-quantized index array, not raw RGB.
function despeckleIndices(indices, W, H) {
  const out = new Int16Array(indices.length);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = indices[y * W + x];
      const neighborCounts = new Map();
      let hasMatch = false;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || xx >= W || yy < 0 || yy >= H) continue;
          const nIdx = indices[yy * W + xx];
          neighborCounts.set(nIdx, (neighborCounts.get(nIdx) || 0) + 1);
          if (nIdx === idx) hasMatch = true;
        }
      }
      if (hasMatch) {
        out[y * W + x] = idx;
        continue;
      }
      let best = idx, bestCount = -1;
      for (const [k, c] of neighborCounts) {
        if (c > bestCount) { bestCount = c; best = k; }
      }
      out[y * W + x] = best;
    }
  }
  return out;
}

// "contain" 装箱：在 bw×bh 的板子里尽量放大，保持画面比例不变形。
// 板子本身可以不是正方形，所以要按两个方向各自能放多少来取较小的那个缩放比。
function computeGrid(srcW, srcH, bw, bh, fillRatio) {
  const scale = Math.min((bw * fillRatio) / srcW, (bh * fillRatio) / srcH);
  let gridW = Math.max(1, Math.round(srcW * scale));
  let gridH = Math.max(1, Math.round(srcH * scale));
  gridW = Math.min(gridW, bw);
  gridH = Math.min(gridH, bh);
  return { gridW, gridH };
}

// Match every source pixel to its nearest Mard color individually (cached by
// a coarse RGB bucket for speed) instead of averaging first — averaging
// blends real colors into a fake intermediate one that can snap to a wrong,
// unrelated palette entry (this is what produced the muddy/blurred results
// and stray near-black cells at high-contrast edges).
//
// `allowed` optionally restricts matching to a subset of MARD_PALETTE (see
// buildReducedPalette). That restriction is the single most effective lever
// against a speckled result: with all 221 colors available, a smooth sky
// gradient snaps to a dozen near-identical blues that alternate cell by
// cell, which reads as noise on the board even though each individual match
// is "correct".
function quantizeIndices(imageData, allowed = null) {
  allowed = allowed || scopedPalette();
  const { width: W, height: H, data } = imageData;
  const cache = new Map();
  const indices = new Int16Array(W * H);
  for (let p = 0; p < W * H; p++) {
    const o = p * 4;
    const r = data[o], g = data[o + 1], b = data[o + 2];
    const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
    let idx = cache.get(key);
    if (idx === undefined) {
      idx = nearestInPalette(r, g, b, allowed).index;
      cache.set(key, idx);
    }
    indices[p] = idx;
  }
  return indices;
}

// ---------- Palette scope (221 standard vs 291 full) ----------
// Defaults to the 221 standard colors because that's what retail boxes ship
// with: matching against colors you can't actually buy produces a pattern
// you can't actually build. The extended P/Q/R/T/Y/ZG series are sold
// separately, so they're opt-in.
//
// Crucially this is a restriction on MATCHING, not a different palette —
// MARD_PALETTE indices stay global, so a cell's stored index means the same
// bead in either mode and switching scope can't scramble an existing grid.
const paletteScopeOptions = document.getElementById("palette-scope");
let useFullPalette = false;

function scopedPalette() {
  return useFullPalette ? MARD_PALETTE : MARD_PALETTE.slice(0, MARD_STANDARD_COUNT);
}

if (paletteScopeOptions) {
  paletteScopeOptions.addEventListener("click", (e) => {
    const btn = e.target.closest(".seg-btn");
    if (!btn) return;
    useFullPalette = btn.dataset.scope === "full";
    [...paletteScopeOptions.children].forEach((b) => b.classList.toggle("active", b === btn));
    regenerate();
  });
}

function nearestInPalette(r, g, b, allowed) {
  const target = rgbToLab(r, g, b);
  let best = allowed[0], bestDist = Infinity;
  for (const entry of allowed) {
    const d = labDistance(target, entry.lab);
    if (d < bestDist) { bestDist = d; best = entry; }
  }
  return best;
}

// ---------- Cartoonify: pick a small global palette (k-means in Lab) -------
// Instead of letting every pixel independently choose from all 221 colors,
// this decides up front which ~K colors the whole picture gets to use, then
// forces every pixel into that set. Large smooth areas (sky, water, a flat
// wall) collapse onto ONE color instead of being tiled with many barely
// distinguishable neighbors, which is what makes the result read as a
// deliberate simplified illustration rather than a blurry copy.
//
// Clustering runs in Lab (not RGB) so "which colors are similar enough to
// merge" matches what the eye says, and it's weighted by pixel count so a
// color that covers half the image can't be outvoted by a handful of
// saturated specks.
function buildReducedPalette(imageData, k) {
  const { width: W, height: H, data } = imageData;

  // Collapse to a coarse histogram first: k-means over ~1e5 raw pixels is
  // needlessly slow when only a few thousand distinct colors exist, and the
  // weights make the clustering better-behaved too.
  const hist = new Map();
  for (let p = 0; p < W * H; p++) {
    const o = p * 4;
    const key = ((data[o] >> 3) << 10) | ((data[o + 1] >> 3) << 5) | (data[o + 2] >> 3);
    hist.set(key, (hist.get(key) || 0) + 1);
  }
  const pts = [];
  for (const [key, count] of hist) {
    const r = ((key >> 10) & 31) * 8 + 4, g = ((key >> 5) & 31) * 8 + 4, b = (key & 31) * 8 + 4;
    const lab = rgbToLab(r, g, b);
    // 权重不是单纯的像素数，而是 sqrt(面积) × 彩度加成。理由是纯按面积
    // 加权会让"占地最大"的颜色吃掉几乎所有聚类名额：一张画里大片中间调
    // 的灰绿会分到十几个几乎看不出区别的簇，而面积小但一眼就看见的东西
    // —— 一把绿伞、一条浅色裙子、一块蓝天 —— 连一个簇都分不到，被并进灰色。
    //
    // sqrt 压平面积差距（10000px 的区域只值 100px 区域的 10 倍，而不是 100
    // 倍），彩度加成再让有颜色的区域优先保住自己的簇。实测在莫奈这类破碎
    // 笔触的画上，伞和裙子从"消失"变成"能认出来"。
    const chroma = Math.hypot(lab[1], lab[2]);
    pts.push({ lab, w: Math.sqrt(count) * (1 + chroma / 12) });
  }
  if (pts.length <= k) return dedupeToMard(pts.map((p) => p.lab));

  // k-means++ seeding: plain random seeding regularly drops every seed into
  // the one dominant color, and the small-but-important regions (eyes, a
  // logo, a highlight) then get no cluster of their own at all.
  const centers = [pts[0].lab];
  const d2 = new Float64Array(pts.length).fill(Infinity);
  while (centers.length < k) {
    let total = 0;
    const last = centers[centers.length - 1];
    for (let i = 0; i < pts.length; i++) {
      const d = labDistance(pts[i].lab, last);
      if (d < d2[i]) d2[i] = d;
      total += d2[i] * pts[i].w;
    }
    if (total <= 0) break;
    let target = Math.random() * total, pick = pts.length - 1;
    for (let i = 0; i < pts.length; i++) {
      target -= d2[i] * pts[i].w;
      if (target <= 0) { pick = i; break; }
    }
    centers.push(pts[pick].lab);
  }

  for (let iter = 0; iter < 12; iter++) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (const pt of pts) {
      let best = 0, bestD = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const d = labDistance(pt.lab, centers[c]);
        if (d < bestD) { bestD = d; best = c; }
      }
      const s = sums[best];
      s[0] += pt.lab[0] * pt.w;
      s[1] += pt.lab[1] * pt.w;
      s[2] += pt.lab[2] * pt.w;
      s[3] += pt.w;
    }
    let moved = 0;
    for (let c = 0; c < centers.length; c++) {
      if (!sums[c][3]) continue;
      const next = [sums[c][0] / sums[c][3], sums[c][1] / sums[c][3], sums[c][2] / sums[c][3]];
      moved += labDistance(next, centers[c]);
      centers[c] = next;
    }
    if (moved < 0.5) break; // converged
  }

  return dedupeToMard(centers);
}

// Snap each cluster center to a real bead color. Several centers can land on
// the same bead, which is fine and even desirable — it means the picture
// genuinely needed fewer colors than requested.
function dedupeToMard(labs) {
  const seen = new Map();
  const pool = scopedPalette();
  for (const lab of labs) {
    let best = pool[0], bestD = Infinity;
    for (const entry of pool) {
      const d = labDistance(lab, entry.lab);
      if (d < bestD) { bestD = d; best = entry; }
    }
    seen.set(best.index, best);
  }
  return [...seen.values()];
}

// Each target cell = the MODE (most frequent) palette color among the source
// pixels it covers, not their average — this keeps small high-contrast
// features (pupils, outlines) intact as an actual palette color instead of
// letting them get diluted into a blended, unrelated one. Mispicked cells
// can be fixed afterward in the cell editor (click/drag-select on the
// pattern preview).
function blockModeQuantize(indices, W, H, gridW, gridH, bgMask) {
  const result = [];
  for (let gy = 0; gy < gridH; gy++) {
    const y0 = Math.floor((gy * H) / gridH);
    const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * H) / gridH));
    const row = [];
    for (let gx = 0; gx < gridW; gx++) {
      const x0 = Math.floor((gx * W) / gridW);
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * W) / gridW));

      if (bgMask) {
        let bgVotes = 0, total = 0;
        for (let y = y0; y < y1; y++) {
          let base = y * W;
          for (let x = x0; x < x1; x++) {
            if (bgMask[base + x]) bgVotes++;
            total++;
          }
        }
        if (bgVotes / total > 0.5) {
          row.push(null); // no bead here — treated as unused board holes
          continue;
        }
      }

      const freq = new Map();
      for (let y = y0; y < y1; y++) {
        let base = y * W;
        for (let x = x0; x < x1; x++) {
          const idx = indices[base + x];
          freq.set(idx, (freq.get(idx) || 0) + 1);
        }
      }
      let bestIdx = -1, bestCount = -1;
      for (const [idx, count] of freq) {
        if (count > bestCount) { bestCount = count; bestIdx = idx; }
      }
      row.push(MARD_PALETTE[bestIdx]);
    }
    result.push(row);
  }
  return result;
}

// ---------- Cell-level majority smoothing (removes checkerboard noise) ----
// Limiting the palette fixes gradients that used a dozen colors, but not the
// other failure mode: where the true color sits exactly between two allowed
// beads, adjacent cells alternate between them and the area comes out
// looking dithered. Those alternating cells form ONE large connected region
// each, so removeSmallRegions can't touch them — the fix has to be spatial.
//
// A cell only flips when a single neighbouring color holds a clear majority
// of the 3x3 window (>= `threshold` of 9). That threshold is what protects
// real detail: a deliberate 2-3 cell feature — an eye, an outline, a
// highlight — never has 5+ of its neighbours agreeing against it, so it
// survives, while noise gets pulled toward whatever dominates locally.
//
// Worth knowing about the shape of the effect: this CLUMPS noise rather than
// erasing a color. An exactly balanced two-color field has no local majority
// to latch onto and barely moves (a perfect checkerboard is a fixed point of
// any symmetric majority filter). What it reliably does is turn scattered
// single cells into contiguous patches — and the leftover single cells at
// the patch edges are then removed by removeSmallRegions. The pair is what
// gets stray-bead counts to zero; neither does it alone.
function smoothCellsByMajority(cells, gridW, gridH, passes, threshold) {
  for (let pass = 0; pass < passes; pass++) {
    // Read from a snapshot so every cell in a pass sees the same input;
    // updating in place would let a decision propagate across the row within
    // one pass and smear features sideways.
    const prev = cells.map((row) => row.slice());
    let changed = 0;
    for (let gy = 0; gy < gridH; gy++) {
      for (let gx = 0; gx < gridW; gx++) {
        const cur = prev[gy][gx];
        if (!cur) continue; // never fill cutout holes
        const votes = new Map();
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const y = gy + dy, x = gx + dx;
            if (y < 0 || y >= gridH || x < 0 || x >= gridW) continue;
            const c = prev[y][x];
            if (!c) continue;
            votes.set(c.index, (votes.get(c.index) || 0) + 1);
          }
        }
        let bestIdx = -1, bestCount = -1;
        for (const [idx, count] of votes) {
          if (count > bestCount) { bestCount = count; bestIdx = idx; }
        }
        if (bestIdx !== -1 && bestIdx !== cur.index && bestCount >= threshold) {
          cells[gy][gx] = MARD_PALETTE[bestIdx];
          changed++;
        }
      }
    }
    if (!changed) break; // stable; further passes can't do anything
  }
  return cells;
}

// ---------- Cell-level region cleanup (removes stray single beads) --------
// Runs on the FINAL cell grid, which is the only place a "stray bead" is
// even definable — the earlier despeckleIndices pass works on source pixels,
// where a 1px speck may still be a legitimate part of a feature that several
// cells will cover. Here, a colored island smaller than `minRegion` cells is
// a bead you'd have to hunt for in the bag, place, and then not be able to
// see in the finished piece; absorbing it into whichever color surrounds it
// costs nothing visually and removes a color from the shopping list.
//
// Background (null) regions are deliberately left alone: a hole in the
// cutout is a real design decision, not noise.
function removeSmallRegions(cells, gridW, gridH, minRegion) {
  if (minRegion <= 1) return cells;
  const idAt = new Int32Array(gridW * gridH).fill(-1);
  const regions = [];

  for (let gy = 0; gy < gridH; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      const p = gy * gridW + gx;
      if (idAt[p] !== -1 || !cells[gy][gx]) continue;
      const code = cells[gy][gx].index;
      const id = regions.length;
      const members = [];
      const stack = [p];
      idAt[p] = id;
      while (stack.length) {
        const q = stack.pop();
        members.push(q);
        const x = q % gridW, y = (q / gridW) | 0;
        const push = (nx, ny) => {
          if (nx < 0 || nx >= gridW || ny < 0 || ny >= gridH) return;
          const np = ny * gridW + nx;
          if (idAt[np] !== -1) return;
          const c = cells[ny][nx];
          if (!c || c.index !== code) return;
          idAt[np] = id;
          stack.push(np);
        };
        push(x - 1, y); push(x + 1, y); push(x, y - 1); push(x, y + 1);
      }
      regions.push({ members, code });
    }
  }

  // Smallest regions first: dissolving those lets a slightly larger neighbor
  // grow, so a cluster of specks collapses into one color instead of each
  // speck independently picking a different survivor.
  regions.sort((a, b) => a.members.length - b.members.length);

  for (const region of regions) {
    if (region.members.length >= minRegion) continue;
    const votes = new Map();
    for (const p of region.members) {
      const x = p % gridW, y = (p / gridW) | 0;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < 0 || nx >= gridW || ny < 0 || ny >= gridH) continue;
        const c = cells[ny][nx];
        if (!c || c.index === region.code) continue;
        votes.set(c.index, (votes.get(c.index) || 0) + 1);
      }
    }
    if (!votes.size) continue; // fully enclosed by background — leave it
    let bestIdx = -1, bestCount = -1;
    for (const [idx, count] of votes) {
      if (count > bestCount) { bestCount = count; bestIdx = idx; }
    }
    const replacement = MARD_PALETTE[bestIdx];
    for (const p of region.members) {
      cells[(p / gridW) | 0][p % gridW] = replacement;
    }
    region.code = bestIdx;
  }
  return cells;
}

// Merges each non-overlapping 2x2 block of an already-quantized cell grid
// into one cell by majority vote (background wins on a 2-2 split, same as
// blockModeQuantize's own >0.5 threshold). Used to derive the 52 board from
// the 104 one — see the comment in regenerate().
function downsampleCellsByHalf(cells, gridW, gridH) {
  const outW = Math.ceil(gridW / 2);
  const outH = Math.ceil(gridH / 2);
  const result = [];
  for (let gy = 0; gy < outH; gy++) {
    const row = [];
    for (let gx = 0; gx < outW; gx++) {
      const sub = [];
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const y = gy * 2 + dy, x = gx * 2 + dx;
          if (y < gridH && x < gridW) sub.push(cells[y][x]);
        }
      }
      const bgCount = sub.filter((c) => !c).length;
      if (bgCount > sub.length / 2) {
        row.push(null);
        continue;
      }
      const freq = new Map();
      for (const c of sub) {
        if (!c) continue;
        freq.set(c.index, (freq.get(c.index) || 0) + 1);
      }
      let bestIdx = -1, bestCount = -1;
      for (const [idx, count] of freq) {
        if (count > bestCount) { bestCount = count; bestIdx = idx; }
      }
      row.push(bestIdx === -1 ? null : MARD_PALETTE[bestIdx]);
    }
    result.push(row);
  }
  return { gridW: outW, gridH: outH, cells: result };
}

// ---------- Rendering ----------

function renderPattern(pattern) {
  drawPatternToCanvas(patternCanvas, pattern, true);
}

// Tallies every placed bead by color code. Single source of truth for the
// side table, the CSV export and the legend printed under the pattern, so
// the three can't drift apart.
function countBeads(cells) {
  const counts = new Map();
  let total = 0;
  for (const row of cells) {
    for (const cell of row) {
      if (!cell) continue;
      const entry = counts.get(cell.code) || { hex: cell.hex, rgb: cell.rgb, count: 0 };
      entry.count++;
      counts.set(cell.code, entry);
      total++;
    }
  }
  // Sort by code (series letter, then numeric part) rather than by count:
  // when you're actually picking beads you look colors up by their printed
  // code, and a count-ordered list reshuffles every time the pattern
  // changes. Numeric-aware so A10 lands after A9, not after A1.
  const sorted = [...counts.entries()].sort((a, b) => {
    const pa = a[0].match(/^([A-Za-z]+)(\d+)$/), pb = b[0].match(/^([A-Za-z]+)(\d+)$/);
    if (pa && pb) return pa[1] === pb[1] ? +pa[2] - +pb[2] : pa[1].localeCompare(pb[1]);
    return a[0].localeCompare(b[0]);
  });
  return { sorted, total };
}

// Shared by the main preview canvas and the cell editor's canvas — both are
// just the same board rendered at the same size, one with an added
// selection outline. `withLegend` appends the color/count list underneath;
// the editor leaves it off so the workbench canvas stays compact and the
// legend can't be mistaken for editable cells.
// ---------- Color highlight / per-row counting ----------
// Placing beads means working one color at a time: you pour out the C20s,
// then hunt for every C20 on the chart. Highlighting dims everything else so
// the search is trivial, and numbering each row's hits left-to-right turns
// "find them" into "count along to 3".
let highlightIndex = null; // MARD_PALETTE index, or null

function setHighlight(idx) {
  highlightIndex = highlightIndex === idx ? null : idx;
  if (lastPattern) {
    renderPattern(lastPattern);
    if (!cellEditor.hidden) renderEditorPatternCanvas();
  }
  renderUsage(lastPattern || { cells: [] });
  updateHighlightInfo();
}

function updateHighlightInfo() {
  const box = document.getElementById("highlight-info");
  if (!box) return;
  if (highlightIndex == null || !lastPattern) {
    box.hidden = true;
    return;
  }
  const entry = MARD_PALETTE[highlightIndex];
  let total = 0, rows = 0, maxRow = 0;
  for (const row of lastPattern.cells) {
    let n = 0;
    for (const c of row) if (c && c.index === highlightIndex) n++;
    if (n) { rows++; if (n > maxRow) maxRow = n; }
    total += n;
  }
  box.hidden = false;
  box.innerHTML =
    `<span class="hl-swatch" style="background:${entry.hex}"></span>` +
    `<strong>${entry.code}</strong> 共 ${total} 颗 · 分布在 ${rows} 行 · 单行最多 ${maxRow} 颗` +
    `<button id="highlight-clear" class="btn-ghost">取消高亮</button>`;
  document.getElementById("highlight-clear").addEventListener("click", () => setHighlight(null));
}

// ---------- Guide lines every 10 cells, with row/column numbers ----------
// The decade lines are centered on the board rather than started from the
// left edge, so the leftover cells split evenly as a margin on both sides:
// 52 = 1 + 5x10 + 1, 78 = 4 + 7x10 + 4, 104 = 2 + 10x10 + 2. Counting from
// either edge then lands on the same lines, which is what you want when
// you're placing beads from whichever corner you started at.
const GUTTER_PX = 30; // room for the row/column numbers along the top and left

// 把间距为 step 的等分线居中铺在 size 格上，返回所有线的位置。
// 除不尽时余数平均分到两侧，而不是从一边开始排、把零头全甩到另一边 ——
// 无论你从哪个角开始数格子，落到的都是同一批线。
//
// 10 格的数数辅助线和 26 格的拼板接缝线用的是同一套逻辑，只是 step 不同。
function centeredLines(size, step) {
  const span = Math.floor(size / step) * step;
  if (span <= 0) return [];
  const margin = (size - span) / 2;
  const lines = [];
  for (let i = margin; i <= size - margin + 0.001; i += step) lines.push(Math.round(i));
  return lines;
}

function drawGuides(ctx, bw, bh, gutter) {
  const pxW = bw * CELL_PX, pxH = bh * CELL_PX;

  ctx.strokeStyle = "rgba(30,30,40,0.55)";
  ctx.lineWidth = 2;
  for (const i of centeredLines(bw, 10)) {
    ctx.beginPath();
    ctx.moveTo(gutter + i * CELL_PX, gutter);
    ctx.lineTo(gutter + i * CELL_PX, gutter + pxH);
    ctx.stroke();
  }
  for (const i of centeredLines(bh, 10)) {
    ctx.beginPath();
    ctx.moveTo(gutter, gutter + i * CELL_PX);
    ctx.lineTo(gutter + pxW, gutter + i * CELL_PX);
    ctx.stroke();
  }

  // Numbers label CELLS, not lines, and run 1..size across the whole board
  // (the margin columns included) so they match the physical pegboard when
  // you count holes.
  ctx.fillStyle = "#5a5a66";
  ctx.font = `600 ${Math.round(CELL_PX * 0.46)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const marksFor = (n) => {
    const set = new Set([1, n]);
    for (let i = 10; i <= n; i += 10) set.add(i);
    return set;
  };
  for (const n of marksFor(bw)) {
    ctx.fillText(String(n), gutter + (n - 0.5) * CELL_PX, gutter / 2);
  }
  for (const n of marksFor(bh)) {
    ctx.save();
    ctx.translate(gutter / 2, gutter + (n - 0.5) * CELL_PX);
    ctx.fillText(String(n), 0, 0);
    ctx.restore();
  }
}

function drawPatternToCanvas(canvas, { gridW, gridH, cells }, withLegend = false) {
  const bw = boardW, bh = boardH;
  const gutter = GUTTER_PX;
  const boardPxW = bw * CELL_PX, boardPxH = bh * CELL_PX;
  const legend = withLegend ? countBeads(cells) : null;
  const legendH = legend ? legendHeight(legend.sorted.length, boardPxW + gutter) : 0;
  canvas.width = boardPxW + gutter;
  canvas.height = boardPxH + gutter + legendH;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // The gutter holding the row/column numbers sits outside the board, so
  // everything board-related is drawn translated by it. Legend drawing
  // restores the identity transform first (see below).
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, boardPxH + gutter);
  ctx.save();
  ctx.translate(gutter, gutter);

  // empty board background (unused peg holes). Bounded to the board's own
  // size, not the whole canvas — the gutter and the legend strip below paint
  // their own backgrounds and must not be covered by this.
  ctx.fillStyle = "#f0ede7";
  ctx.fillRect(0, 0, boardPxW, boardPxH);
  ctx.fillStyle = "#c9c2b4";
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      ctx.beginPath();
      ctx.arc(x * CELL_PX + CELL_PX / 2, y * CELL_PX + CELL_PX / 2, CELL_PX * 0.14, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const offsetX = Math.floor((bw - gridW) / 2);
  const offsetY = Math.floor((bh - gridH) / 2);

  ctx.font = `bold ${Math.round(CELL_PX * 0.36)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // When a color is highlighted, its cells get a per-row running number
  // instead of the color code, and every other cell is washed out. The
  // number restarts on each row because you place beads a row at a time:
  // "this is the 3rd C20 in this row" is directly actionable, whereas a
  // running total across the whole board tells you nothing about where you
  // are in the row you're currently working on.
  const hl = highlightIndex;
  for (let gy = 0; gy < gridH; gy++) {
    let rowSeq = 0;
    for (let gx = 0; gx < gridW; gx++) {
      const cell = cells[gy][gx];
      if (!cell) continue; // cut out — leave the empty peg-hole background showing
      const { hex, code, rgb } = cell;
      const px = (offsetX + gx) * CELL_PX, py = (offsetY + gy) * CELL_PX;
      const isHit = hl != null && cell.index === hl;
      if (isHit) rowSeq++;

      ctx.globalAlpha = hl == null || isHit ? 1 : 0.22;
      ctx.fillStyle = hex;
      ctx.fillRect(px, py, CELL_PX, CELL_PX);
      ctx.globalAlpha = 1;

      if (hl != null && !isHit) continue; // dimmed cells stay unlabelled, so the numbers pop

      const luminance = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
      if (isHit) {
        // Ring the cell so the highlighted color is findable even where its
        // own hue is close to a neighbour's.
        ctx.strokeStyle = "#e8590c";
        ctx.lineWidth = 2;
        ctx.strokeRect(px + 1, py + 1, CELL_PX - 2, CELL_PX - 2);
        ctx.font = `bold ${Math.round(CELL_PX * 0.5)}px sans-serif`;
        ctx.fillStyle = luminance > 0.55 ? "#111" : "#fff";
        ctx.fillText(String(rowSeq), px + CELL_PX / 2, py + CELL_PX / 2 + 1);
        ctx.font = `bold ${Math.round(CELL_PX * 0.36)}px sans-serif`;
      } else {
        ctx.fillStyle = luminance > 0.55 ? "#222" : "#fff";
        ctx.fillText(code, px + CELL_PX / 2, py + CELL_PX / 2 + 1);
      }
    }
  }

  // fine grid lines
  ctx.strokeStyle = "rgba(0,0,0,0.12)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= bw; i++) {
    ctx.beginPath(); ctx.moveTo(i * CELL_PX, 0); ctx.lineTo(i * CELL_PX, boardPxH); ctx.stroke();
  }
  for (let i = 0; i <= bh; i++) {
    ctx.beginPath(); ctx.moveTo(0, i * CELL_PX); ctx.lineTo(boardPxW, i * CELL_PX); ctx.stroke();
  }
  // 拼接缝：每 26 格是一块实体拼豆板的边界。尺寸不是 26 整数倍时（比如 40）
  // 把这些线居中摆 —— 你手上的板子还是 26 格的，只是拼不满，剩下的零头分在
  // 两边。从边上开始排会让零头全堆在一侧，跟实际怎么拼对不上。
  ctx.strokeStyle = "rgba(150,140,120,0.7)";
  ctx.lineWidth = 1.5;
  for (const i of centeredLines(bw, BOARD_UNIT)) {
    ctx.beginPath(); ctx.moveTo(i * CELL_PX, 0); ctx.lineTo(i * CELL_PX, boardPxH); ctx.stroke();
  }
  for (const i of centeredLines(bh, BOARD_UNIT)) {
    ctx.beginPath(); ctx.moveTo(0, i * CELL_PX); ctx.lineTo(boardPxW, i * CELL_PX); ctx.stroke();
  }

  ctx.restore(); // back to canvas coords; guides draw their own gutter offset
  drawGuides(ctx, bw, bh, gutter);

  if (legend) drawLegend(ctx, legend, boardPxH + gutter, canvas.width);
}

// ---------- Bead-count legend (drawn under the board) ----------
// Lives on the canvas rather than only in the HTML table so that the single
// exported PNG is self-sufficient: you can print it or send it to someone
// and they have both the pattern and the shopping list in one image.

const LEGEND_ITEM_W = 190;   // px per legend entry, incl. swatch + text
const LEGEND_ITEM_H = 40;
const LEGEND_PAD = 24;
const LEGEND_HEADER_H = 56;

function legendColumns(canvasWidth) {
  return Math.max(1, Math.floor((canvasWidth - LEGEND_PAD * 2) / LEGEND_ITEM_W));
}

function legendHeight(itemCount, canvasWidth) {
  const rows = Math.ceil(itemCount / legendColumns(canvasWidth));
  return LEGEND_HEADER_H + rows * LEGEND_ITEM_H + LEGEND_PAD;
}

function drawLegend(ctx, { sorted, total }, top, canvasWidth) {
  const cols = legendColumns(canvasWidth);
  const colW = (canvasWidth - LEGEND_PAD * 2) / cols;

  // Opaque white so the exported PNG prints cleanly and the strip reads as a
  // separate "parts list" panel rather than a continuation of the board.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, top, canvasWidth, legendHeight(sorted.length, canvasWidth));

  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, top + 1);
  ctx.lineTo(canvasWidth, top + 1);
  ctx.stroke();

  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillStyle = "#222";
  ctx.font = "bold 22px sans-serif";
  ctx.fillText(`用豆清单 — 共 ${sorted.length} 色 / ${total} 颗`, LEGEND_PAD, top + LEGEND_HEADER_H / 2 + 4);

  ctx.font = "16px sans-serif";
  sorted.forEach(([code, { hex, count }], i) => {
    // Row-major (reading order) rather than column-major: the list is sorted
    // by code, and filling down columns first makes the first visible row
    // read "A1 A10 B2 C4…", which looks unsorted at a glance even though it
    // isn't. Wrapping like text keeps the ordering obvious.
    const col = i % cols, row = Math.floor(i / cols);
    const x = LEGEND_PAD + col * colW;
    const y = top + LEGEND_HEADER_H + row * LEGEND_ITEM_H + LEGEND_ITEM_H / 2;

    const sw = 26;
    ctx.fillStyle = hex;
    ctx.fillRect(x, y - sw / 2, sw, sw);
    ctx.strokeStyle = "rgba(0,0,0,0.3)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y - sw / 2 + 0.5, sw - 1, sw - 1);
    ctx.fillStyle = "#111";
    ctx.font = "bold 17px sans-serif";
    ctx.fillText(code, x + sw + 10, y);
    ctx.fillStyle = "#555";
    ctx.font = "16px sans-serif";
    ctx.fillText(`${count} 颗`, x + sw + 10 + 62, y);
  });
}

// ---------- Usage table sorting ----------
// Only the on-screen table reorders. The legend printed under the pattern
// and the CSV stay in code order on purpose: those are things you read while
// physically picking beads out of bags, where you look a code up rather than
// scan a ranking, and a list whose order depends on a UI toggle you set
// twenty minutes ago is a list you can't trust.
let usageSort = { key: "code", dir: 1 };

function compareUsageRows(a, b) {
  const { key, dir } = usageSort;
  if (key === "count") return dir * (a.count - b.count) || a.code.localeCompare(b.code);
  if (key === "stock") return dir * (a.stock - b.stock) || a.code.localeCompare(b.code);
  // 色号：字母升序 + 数字正序，A9 排在 A10 前面
  const pa = a.code.match(/^([A-Za-z]+)(\d+)$/), pb = b.code.match(/^([A-Za-z]+)(\d+)$/);
  if (pa && pb) return dir * (pa[1] === pb[1] ? +pa[2] - +pb[2] : pa[1].localeCompare(pb[1]));
  return dir * a.code.localeCompare(b.code);
}

function updateSortArrows() {
  for (const btn of document.querySelectorAll(".th-sort")) {
    const active = btn.dataset.sort === usageSort.key;
    btn.classList.toggle("is-active", active);
    const arrow = btn.querySelector(".sort-arrow");
    if (arrow) arrow.textContent = active ? (usageSort.dir > 0 ? "▲" : "▼") : "";
  }
}

document.querySelectorAll(".th-sort").forEach((btn) => {
  btn.addEventListener("click", () => {
    const key = btn.dataset.sort;
    // 同一列再点一次翻转方向；换列时给个合理的初始方向 —— 数量类的列，
    // 人想看的多半是"最多的是哪些"，所以从大到小开始。
    if (usageSort.key === key) usageSort.dir *= -1;
    else usageSort = { key, dir: key === "code" ? 1 : -1 };
    if (lastPattern) renderUsage(lastPattern);
  });
});

function renderUsage({ cells }) {
  const { sorted, total } = countBeads(cells);
  const codeToIndex = new Map(MARD_PALETTE.map((e) => [e.code, e.index]));

  const rows = sorted
    .map(([code, v]) => ({ code, hex: v.hex, count: v.count, stock: stockOf(code) }))
    .sort(compareUsageRows);
  updateSortArrows();

  usageTableBody.innerHTML = "";
  for (const { code, hex, count } of rows) {
    const tr = document.createElement("tr");
    const idx = codeToIndex.get(code);
    const have = stockOf(code);
    const short = Math.max(0, count - have);
    tr.className = "usage-row" + (idx === highlightIndex ? " is-active" : "") + (short ? " is-short" : "");
    tr.innerHTML =
      `<td>${code}</td>` +
      `<td><span class="swatch" style="background:${hex}"></span></td>` +
      `<td class="num">${count}</td>` +
      `<td class="num stock-cell">${short ? `<span class="short">差 ${short}</span>` : have}</td>`;
    tr.addEventListener("click", () => setHighlight(idx));
    usageTableBody.appendChild(tr);
  }
  const tr = document.createElement("tr");
  tr.className = "usage-total";
  const totalHave = sorted.reduce((n, [code]) => n + stockOf(code), 0);
  tr.innerHTML = `<td>合计</td><td>${sorted.length} 色</td><td class="num">${total}</td><td class="num">${totalHave}</td>`;
  usageTableBody.appendChild(tr);

  renderInventoryStatus(sorted, total);
}

// ---------- Bead inventory ----------
// Kept in the browser's own storage rather than a file: the whole app is
// client-side and this is personal bookkeeping, so there's nothing to sync
// and nowhere to sync it to. CSV export exists so it isn't trapped there —
// clearing site data would otherwise lose the lot.
//
// Keyed by color CODE, not palette index: the code is what's printed on the
// bag you bought, and it stays meaningful if the palette array ever changes
// order or grows.
const INVENTORY_KEY = "pixel-bead-inventory-v1";
const INVENTORY_LOG_KEY = "pixel-bead-inventory-log-v1";

function storage() {
  try { return window.localStorage || null; } catch (e) { return null; } // private mode / blocked
}
function loadStored(key, fallback) {
  const s = storage();
  if (!s) return fallback;
  try { return JSON.parse(s.getItem(key)) ?? fallback; } catch (e) { return fallback; }
}
function saveStored(key, value) {
  const s = storage();
  if (!s) return;
  try { s.setItem(key, JSON.stringify(value)); } catch (e) { /* quota / blocked — keep going in memory */ }
}

let inventory = loadStored(INVENTORY_KEY, {});
let inventoryLog = loadStored(INVENTORY_LOG_KEY, []);

function stockOf(code) {
  return Math.max(0, Math.floor(inventory[code] || 0));
}

function setStock(code, n) {
  const v = Math.max(0, Math.floor(Number(n) || 0));
  if (v) inventory[code] = v; else delete inventory[code];
  saveStored(INVENTORY_KEY, inventory);
  // 所有改动库存的路径（手动改、补齐、扣减、导入 CSV）最终都会走到这里，
  // 所以自动上传只需要挂在这一个点上。
  if (typeof scheduleSyncPush === "function") scheduleSyncPush();
}

// What the current pattern needs vs. what's on hand.
function shortageReport(sorted) {
  const lines = sorted.map(([code, { count }]) => {
    const have = stockOf(code);
    return { code, need: count, have, short: Math.max(0, count - have) };
  });
  const shortLines = lines.filter((l) => l.short > 0);
  return {
    lines,
    shortLines,
    shortColors: shortLines.length,
    shortBeads: shortLines.reduce((n, l) => n + l.short, 0),
  };
}

const inventoryStatus = document.getElementById("inventory-status");
const deductBtn = document.getElementById("inventory-deduct");
const undoBtn = document.getElementById("inventory-undo");

function renderInventoryStatus(sorted, total) {
  if (!inventoryStatus) return;
  const anyStock = Object.keys(inventory).length > 0;
  if (deductBtn) deductBtn.disabled = !sorted.length;
  if (undoBtn) undoBtn.disabled = !inventoryLog.length;

  if (!anyStock) {
    inventoryStatus.className = "inventory-status is-empty";
    inventoryStatus.textContent = "还没有登记库存。点「管理库存」录入你手上的豆子，之后就能看出这张图缺什么。";
    return;
  }
  const rep = shortageReport(sorted);
  if (rep.shortColors === 0) {
    inventoryStatus.className = "inventory-status is-ok";
    inventoryStatus.textContent = `库存够拼这张图（需要 ${total} 颗，共 ${sorted.length} 色）。`;
  } else {
    inventoryStatus.className = "inventory-status is-short";
    const worst = rep.shortLines.slice().sort((a, b) => b.short - a.short).slice(0, 4)
      .map((l) => `${l.code} 差 ${l.short}`).join("、");
    inventoryStatus.textContent =
      `库存不足：${rep.shortColors} 种颜色共差 ${rep.shortBeads} 颗（${worst}${rep.shortColors > 4 ? " 等" : ""}）。`;
  }
}

// Deduction is an explicit action, never a side effect of exporting or
// rendering — you often export a chart just to look at it, and silently
// spending your stock for that would be both wrong and hard to notice.
// Every deduction is logged so it can be undone.
function deductCurrentPattern() {
  if (!lastPattern) return;
  const { sorted, total } = countBeads(lastPattern.cells);
  if (!sorted.length) return;
  const rep = shortageReport(sorted);
  const warn = rep.shortColors
    ? `\n\n注意：有 ${rep.shortColors} 种颜色库存不足，共差 ${rep.shortBeads} 颗。继续的话这些颜色会扣到 0。`
    : "";
  if (!window.confirm(`从库存中扣除这张图纸的用量？\n${sorted.length} 色 / ${total} 颗。${warn}`)) return;

  const entry = { at: Date.now(), board: `${boardW}x${boardH}`, total, items: {} };
  for (const [code, { count }] of sorted) {
    const have = stockOf(code);
    entry.items[code] = Math.min(have, count); // record what was actually taken
    setStock(code, have - count);
  }
  inventoryLog.push(entry);
  if (inventoryLog.length > 50) inventoryLog = inventoryLog.slice(-50);
  saveStored(INVENTORY_LOG_KEY, inventoryLog);
  renderUsage(lastPattern);
  renderInventoryEditor();
}

function undoLastDeduction() {
  const entry = inventoryLog.pop();
  if (!entry) return;
  // Give back exactly what was taken, so undoing a deduction that ran into a
  // shortage doesn't invent beads that were never there.
  for (const [code, taken] of Object.entries(entry.items)) setStock(code, stockOf(code) + taken);
  saveStored(INVENTORY_LOG_KEY, inventoryLog);
  if (lastPattern) renderUsage(lastPattern);
  renderInventoryEditor();
}

if (deductBtn) deductBtn.addEventListener("click", deductCurrentPattern);
if (undoBtn) undoBtn.addEventListener("click", undoLastDeduction);

// ---------- Inventory editor panel ----------
const inventoryPanel = document.getElementById("inventory-panel");
const inventoryList = document.getElementById("inventory-list");
const inventoryFilter = document.getElementById("inventory-filter");
let inventoryShowAll = false;

function inventoryRows() {
  // Default view is "colors that matter right now": what this pattern needs
  // plus anything already stocked. Listing all 291 up front turns a quick
  // top-up into scrolling.
  const codes = new Set(Object.keys(inventory));
  if (!inventoryShowAll && lastPattern) {
    for (const [code] of countBeads(lastPattern.cells).sorted) codes.add(code);
  }
  const pool = inventoryShowAll ? scopedPalette().map((e) => e.code) : [...codes];
  const need = new Map(lastPattern ? countBeads(lastPattern.cells).sorted.map(([c, v]) => [c, v.count]) : []);
  const byCode = new Map(MARD_PALETTE.map((e) => [e.code, e]));
  return pool
    .filter((c) => byCode.has(c))
    .sort((a, b) => {
      const pa = a.match(/^([A-Za-z]+)(\d+)$/), pb = b.match(/^([A-Za-z]+)(\d+)$/);
      if (pa && pb) return pa[1] === pb[1] ? +pa[2] - +pb[2] : pa[1].localeCompare(pb[1]);
      return a.localeCompare(b);
    })
    .map((code) => ({ code, entry: byCode.get(code), have: stockOf(code), need: need.get(code) || 0 }));
}

// ---------- Adjust a single color by a delta ----------
// Absolute numbers are the wrong unit for the two things that actually
// happen to a stash: you used some, or you bought some. Both are deltas, and
// making the user compute "I had 412, used 37, so type 375" is arithmetic
// the page should be doing. The absolute field stays for corrections after
// an actual recount.
//
// Selection here is the INVENTORY row, deliberately kept separate from the
// pattern's highlighted color. They answer different questions — "which
// bead am I looking for on the chart" vs "which row am I editing" — and
// tying them together meant opening the stock panel silently repainted the
// chart behind it.
const inventoryAdjust = document.getElementById("inventory-adjust");
let invSelected = null; // 色号字符串
let adjustNote = "";

function adjustDelta() {
  const input = document.getElementById("inventory-adjust-value");
  const n = Math.floor(Number(input && input.value));
  return Number.isFinite(n) ? Math.abs(n) : 0;
}

function setAdjustNote(text) {
  adjustNote = text;
  const box = document.getElementById("inventory-adjust-note");
  if (box) box.textContent = text;
}

// sign: +1 补货 / -1 用掉。code 省略时作用于当前选中的行。
function applyAdjust(sign, code) {
  const target = code || invSelected;
  if (!target) return;
  const before = stockOf(target);
  const next = before + sign * adjustDelta();
  setStock(target, next);
  invSelected = target;
  if (lastPattern) renderUsage(lastPattern);
  renderInventoryEditor();
  const after = stockOf(target);
  setAdjustNote(`${target}：${before} → ${after} 颗${next < 0 ? "（不能减到负数，已停在 0）" : ""}`);
}

function selectInventoryRow(code) {
  invSelected = invSelected === code ? null : code;
  setAdjustNote("");
  renderInventoryEditor();
}

function renderInventoryAdjust() {
  if (!inventoryAdjust) return;
  const amount = `<input type="number" id="inventory-adjust-value" min="0" step="1" value="${adjustDelta() || 10}" aria-label="加减数量" />`;

  if (!invSelected) {
    inventoryAdjust.innerHTML =
      `<p class="hint">点下面列表里的任意一行选中它，就能在这里加减。也可以直接用每行右边的 <b>−</b> / <b>+</b> 按钮。</p>` +
      `<div class="adjust-row"><span class="hint">每次加减</span>${amount}<span class="hint">颗</span></div>`;
    bindAdjustAmount();
    return;
  }

  const entry = MARD_PALETTE.find((e) => e.code === invSelected);
  const have = stockOf(invSelected);
  const need = lastPattern
    ? (countBeads(lastPattern.cells).sorted.find(([c]) => c === invSelected) || [null, { count: 0 }])[1].count
    : 0;
  inventoryAdjust.innerHTML =
    `<div class="adjust-head">` +
      `<span class="swatch" style="background:${entry ? entry.hex : "#fff"}"></span>` +
      `<strong>${invSelected}</strong>` +
      `<span class="hint">现有 ${have} 颗${need ? ` · 本图需 ${need} 颗` : ""}</span>` +
    `</div>` +
    `<div class="adjust-row">` +
      `<button id="inventory-adjust-minus" class="btn-ghost">− 用掉</button>` +
      amount +
      `<button id="inventory-adjust-plus" class="btn-ghost">+ 补货</button>` +
    `</div>` +
    `<p class="hint" id="inventory-adjust-note">${adjustNote}</p>`;
  document.getElementById("inventory-adjust-plus").addEventListener("click", () => applyAdjust(1));
  document.getElementById("inventory-adjust-minus").addEventListener("click", () => applyAdjust(-1));
  bindAdjustAmount();
}

function bindAdjustAmount() {
  const input = document.getElementById("inventory-adjust-value");
  if (!input) return;
  // 回车默认按"补货"处理：拆一包豆子倒进盒子是最常发生的那件事。
  input.addEventListener("keydown", (evt) => {
    if (evt.key === "Enter" && invSelected) { evt.preventDefault(); applyAdjust(1); }
  });
}

function renderInventoryEditor() {
  if (!inventoryList) return;
  updateBulkScope();
  updateSyncWhere();
  renderInventoryAdjust();
  const rows = inventoryRows();
  inventoryList.innerHTML = "";
  if (!rows.length) {
    inventoryList.innerHTML = `<p class="hint">先生成一张图纸，或点「显示全部色号」手动录入。</p>`;
    return;
  }
  for (const { code, entry, have, need } of rows) {
    const row = document.createElement("div");
    row.className = "inv-row" + (need && have < need ? " is-short" : "") +
      (code === invSelected ? " is-selected" : "");
    row.innerHTML =
      `<span class="swatch" style="background:${entry.hex}"></span>` +
      `<span class="inv-code">${code}</span>` +
      `<span class="inv-need">${need ? `本图需 ${need}` : ""}</span>` +
      `<button class="inv-step" data-step="-1" title="用掉">−</button>` +
      `<input type="number" min="0" step="1" value="${have}" class="inv-input" aria-label="${code} 库存" />` +
      `<button class="inv-step" data-step="1" title="补货">+</button>`;

    // 点行选中它作为上方加减的目标。这里只影响库存面板 —— 不去动画板的
    // 高亮，那是另一个问题的答案（"这颗豆子在图纸哪儿"）。
    row.addEventListener("click", (evt) => {
      if (evt.target.classList.contains("inv-input") || evt.target.classList.contains("inv-step")) return;
      selectInventoryRow(code);
    });

    // 每行自带加减，不必先选中 —— 想快速调几个颜色时少一次点击。
    for (const btn of row.querySelectorAll(".inv-step")) {
      btn.addEventListener("click", () => applyAdjust(Number(btn.dataset.step), code));
    }

    const input = row.querySelector(".inv-input");
    input.addEventListener("change", () => {
      setStock(code, input.value);
      invSelected = code;
      if (lastPattern) renderUsage(lastPattern);
      renderInventoryEditor();
      setAdjustNote(`${code}：已直接设为 ${stockOf(code)} 颗`);
    });
    inventoryList.appendChild(row);
  }
}

function bindIfPresent(id, event, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(event, handler);
  return el;
}

bindIfPresent("inventory-open", "click", () => {
  inventoryPanel.hidden = false;
  renderInventoryEditor();
});
bindIfPresent("inventory-close", "click", () => { inventoryPanel.hidden = true; });

if (inventoryFilter) {
  inventoryFilter.addEventListener("click", () => {
    inventoryShowAll = !inventoryShowAll;
    inventoryFilter.textContent = inventoryShowAll ? "只显示相关色号" : "显示全部色号";
    renderInventoryEditor(); // 内部会刷新「作用范围」说明

  });
}

// ---------- Bulk fill ----------
// Beads are bought by the bag, not by the bead: "I have roughly 500 of
// everything" is the normal starting state, and expressing it by typing 500
// into 291 boxes is absurd. Both actions apply to exactly the rows currently
// listed, so the 「显示全部色号」 toggle doubles as the scope selector — that
// way "set all" can mean either "everything this pattern needs" or "my whole
// collection" without needing a second control.
function bulkValue() {
  const input = document.getElementById("inventory-bulk-value");
  const n = Math.max(0, Math.floor(Number(input && input.value)));
  return Number.isFinite(n) ? n : 0;
}

function applyBulk(mode) {
  const rows = inventoryRows();
  if (!rows.length) return;
  const n = bulkValue();
  const verb = mode === "set" ? "设为" : "各加";
  if (!window.confirm(`把下面列出的 ${rows.length} 个色号全部${verb} ${n} 颗？`)) return;
  for (const { code, have } of rows) setStock(code, mode === "set" ? n : have + n);
  if (lastPattern) renderUsage(lastPattern);
  renderInventoryEditor();
}

bindIfPresent("inventory-bulk-set", "click", () => applyBulk("set"));
bindIfPresent("inventory-bulk-add", "click", () => applyBulk("add"));

function updateBulkScope() {
  const box = document.getElementById("inventory-bulk-scope");
  if (!box) return;
  const n = inventoryRows().length;
  box.textContent = inventoryShowAll
    ? `作用范围：全部 ${n} 个色号（当前色卡）`
    : `作用范围：下方列出的 ${n} 个色号（这张图用到的 + 已登记的）。想覆盖所有颜色，先点「显示全部色号」。`;
}

// Fill in exactly what the current pattern is missing — the common case is
// "I just bought enough for this piece", and typing 30-odd numbers by hand
// to express that is the kind of chore that stops people using the feature.
bindIfPresent("inventory-fill", "click", () => {
  if (!lastPattern) return;
  const { sorted } = countBeads(lastPattern.cells);
  let touched = 0;
  for (const [code, { count }] of sorted) {
    if (stockOf(code) < count) { setStock(code, count); touched++; }
  }
  renderUsage(lastPattern);
  renderInventoryEditor();
  if (!touched) window.alert("库存已经够拼这张图了，没有需要补的颜色。");
});

bindIfPresent("inventory-clear", "click", () => {
  if (!window.confirm("清空全部库存记录？此操作不能撤销。")) return;
  inventory = {};
  inventoryLog = [];
  saveStored(INVENTORY_KEY, inventory);
  saveStored(INVENTORY_LOG_KEY, inventoryLog);
  if (lastPattern) renderUsage(lastPattern);
  renderInventoryEditor();
});

bindIfPresent("inventory-export", "click", () => {
  const rows = Object.entries(inventory).filter(([, n]) => n > 0);
  let csv = "色号,库存\n";
  for (const [code, n] of rows) csv += `${code},${n}\n`;
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.download = "拼豆库存.csv";
  a.href = URL.createObjectURL(blob);
  a.click();
});

// ---------- Cloud sync (optional) ----------
// Talks to the little Cloudflare Worker in worker/. Entirely opt-in: with no
// server configured everything above keeps working exactly as before, purely
// in this browser. The settings live in localStorage rather than in the
// source, because the repo is public — a passcode committed to it would be a
// passcode published to the world.
const SYNC_KEY = "pixel-bead-sync-v1";
let syncConfig = loadStored(SYNC_KEY, { url: "", passcode: "" });
// 服务端根据口令告诉我们"你是谁"，客户端不再自报家门。
let syncProfile = "";

const syncStatusBox = document.getElementById("sync-status");
const syncUrlInput = document.getElementById("sync-url");
const syncPassInput = document.getElementById("sync-passcode");

function syncReady() {
  return !!(syncConfig.url && syncConfig.passcode);
}

function setSyncStatus(text, kind) {
  if (!syncStatusBox) return;
  syncStatusBox.textContent = text || "";
  syncStatusBox.className = "sync-status" + (kind ? " is-" + kind : "");
  syncStatusBox.hidden = !text;
}

async function syncRequest(path, options = {}) {
  const base = syncConfig.url.replace(/\/+$/, "");
  const res = await fetch(base + path, {
    ...options,
    headers: {
      Authorization: "Bearer " + syncConfig.passcode,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* 保留 null，下面按状态码报错 */ }
  if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
  return data;
}

async function syncPull() {
  if (!syncReady()) return setSyncStatus("请先填好服务器地址、口令和档案名", "error");
  setSyncStatus("正在从云端读取…");
  try {
    const data = await syncRequest("/api/inventory");
    syncProfile = data.profile || "";
    inventory = data.inventory || {};
    saveStored(INVENTORY_KEY, inventory);
    if (lastPattern) renderUsage(lastPattern);
    renderInventoryEditor();
    const when = data.updatedAt ? new Date(data.updatedAt).toLocaleString() : "从未保存";
    updateSyncWhere();
    setSyncStatus(`已拉取「${syncProfile}」的库存（云端更新于 ${when}）`, "ok");
  } catch (err) {
    setSyncStatus("拉取失败：" + err.message, "error");
  }
}

async function syncPush() {
  if (!syncReady()) return setSyncStatus("请先填好服务器地址、口令和档案名", "error");
  setSyncStatus("正在上传…");
  try {
    const data = await syncRequest("/api/inventory", {
      method: "PUT",
      body: JSON.stringify({ inventory }),
    });
    syncProfile = data.profile || syncProfile;
    setSyncStatus(`已上传到「${syncProfile}」（${new Date(data.updatedAt).toLocaleString()}）`, "ok");
  } catch (err) {
    setSyncStatus("上传失败：" + err.message, "error");
  }
}

// KV 免费额度是每天 1000 次写、10 万次读，写比读金贵一百倍。手动改库存时
// 每敲一个数字就传一次很容易把写额度耗掉，所以合并成一次延迟上传。
let syncTimer = null;
function scheduleSyncPush() {
  if (!syncReady() || !syncConfig.autoPush) return;
  clearTimeout(syncTimer);
  setSyncStatus("有改动，稍后自动上传…");
  syncTimer = setTimeout(syncPush, 2500);
}

// A one-line answer to "where is my data right now", always visible. The
// previous version showed three empty fields and no state, so there was no
// way to tell "not set up" apart from "set up but broken".
function updateSyncWhere() {
  const box = document.getElementById("sync-where");
  if (!box) return;
  if (!syncReady()) {
    box.className = "sync-where is-local";
    box.innerHTML =
      `<strong>只存在这台设备</strong>浏览器里（未连接同步服务器）。` +
      `换设备或清理浏览器数据会丢，建议用上面的「导出 CSV 备份」。`;
    return;
  }
  let host = syncConfig.url;
  try { host = new URL(syncConfig.url).host; } catch (e) { /* 地址还没填对，就照原样显示 */ }
  box.className = "sync-where is-cloud";
  box.innerHTML =
    `已连接 <strong>${host}</strong>` +
    (syncProfile ? ` · 你是「<strong>${syncProfile}</strong>」` : " · 尚未验证身份，点「保存并测试连接」") +
    `${syncConfig.autoPush ? " · 改动后自动上传" : " · 需手动点上传"}`;
}

// Saving also verifies, because "saved" on its own tells you nothing about
// whether the address and passcode are actually right — and a silent
// mis-configuration here looks identical to working until the day you switch
// devices and find nothing there.
bindIfPresent("sync-save", "click", async () => {
  syncConfig = {
    url: (syncUrlInput.value || "").trim(),
    passcode: (syncPassInput.value || "").trim(),
    autoPush: document.getElementById("sync-auto").checked,
  };
  saveStored(SYNC_KEY, syncConfig);
  updateSyncWhere();
  if (!syncReady()) {
    setSyncStatus("服务器地址和口令都要填。", "error");
    return;
  }
  setSyncStatus("正在测试连接…");
  try {
    const data = await syncRequest("/api/inventory");
    syncProfile = data.profile || "";
    updateSyncWhere();
    const n = Object.keys(data.inventory || {}).length;
    setSyncStatus(
      n
        ? `连接成功，服务器认出你是「${syncProfile}」。云端已有 ${n} 个色号 —— 点「从云端拉取」取回，或点「上传到云端」用本机数据覆盖它。`
        : `连接成功，服务器认出你是「${syncProfile}」。云端还是空的 —— 点「上传到云端」把本机库存存上去。`,
      "ok"
    );
  } catch (err) {
    // 按失败的类型给出不同的排查方向 —— 一句笼统的"检查地址和口令"会让人
    // 反复核对其实没错的东西。三种失败的根因完全不同：
    //   401  服务端收到了请求但不认这个口令 → 名单或代码版本的问题
    //   网络 请求根本没到 → 地址写错，或 CORS（浏览器此时拿不到状态码）
    //   500  服务端自己没配好 → 通常是 KV 没绑
    const msg = err.message || "";
    let hint;
    if (msg === "口令不对") {
      hint = "服务器上跑的是旧版代码（旧版只认单一 PASSCODE）。把最新的 worker/src/index.js 重新粘贴并 Deploy 一次。";
    } else if (msg.includes("口令不对")) {
      hint = "代码是新的，问题在名单：确认 KV 里有一条键为「user:你的口令」的记录，且口令只含字母数字和 -_、至少 6 位。";
    } else if (msg.includes("没配置") || msg.includes("KV")) {
      hint = "服务器没绑好 KV：在 Worker 顶部的 Bindings 标签页加一个变量名为 INVENTORY 的 KV namespace。";
    } else if (msg.startsWith("HTTP")) {
      hint = "服务器返回了异常状态，检查 Worker 是否部署成功。";
    } else {
      hint = "请求没能送达：检查地址是否完整（带 https:// 和 .workers.dev），以及服务器的 ALLOWED_ORIGIN 是否填了本站地址。";
    }
    setSyncStatus("连不上：" + msg + " —— " + hint, "error");
  }
});
bindIfPresent("sync-pull", "click", syncPull);
bindIfPresent("sync-push", "click", syncPush);
updateSyncWhere();

function restoreSyncForm() {
  if (!syncUrlInput) return;
  syncUrlInput.value = syncConfig.url || "";
  syncPassInput.value = syncConfig.passcode || "";
  const auto = document.getElementById("sync-auto");
  if (auto) auto.checked = !!syncConfig.autoPush;
}
restoreSyncForm();

bindIfPresent("inventory-import", "change", (evt) => {
  const file = evt.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const known = new Set(MARD_PALETTE.map((e) => e.code));
    let applied = 0, skipped = 0;
    for (const line of String(reader.result).split(/\r?\n/)) {
      const [rawCode, rawN] = line.split(",");
      if (!rawCode || rawN === undefined) continue;
      const code = rawCode.replace(/^﻿/, "").trim();
      const n = Number(String(rawN).trim());
      if (!known.has(code) || !Number.isFinite(n)) { if (code && code !== "色号") skipped++; continue; }
      setStock(code, n);
      applied++;
    }
    if (lastPattern) renderUsage(lastPattern);
    renderInventoryEditor();
    window.alert(`已导入 ${applied} 个色号的库存${skipped ? `，${skipped} 行无法识别已跳过` : ""}。`);
    evt.target.value = "";
  };
  reader.readAsText(file);
});

// ---------- Cell editor (manual per-cell color fixing) ----------
// Replaces the old auto text/detail regions: those tried to guess where
// fine detail or text sat and re-render it automatically, but an imprecise
// guess (a false-positive text box, a region that grazed the wrong pixels)
// produced worse results than just leaving the base render alone. This
// instead lets the user pick the exact cell(s) that are wrong and fix them
// directly — no detection heuristics to get wrong. It edits `lastPattern`
// in place, so it's a final pass: re-running the main pipeline (crop/board/
// cutout/fill changes) rebuilds `cells` from scratch and any edits made
// here are gone, same as any other setting change.

const cellEditor = document.getElementById("cell-editor");
const editorExitBtn = document.getElementById("editor-exit");
const editorSourceCanvas = document.getElementById("editor-source-canvas");
const editorPatternCanvas = document.getElementById("editor-pattern-canvas");
const editorRecommendColors = document.getElementById("editor-recommend-colors");
const editorSelectionInfo = document.getElementById("editor-selection-info");

// The selection is a SET of individual cells, not a rectangle. A rectangle
// is the wrong shape for the actual job here: the cells that came out wrong
// are usually an outline, a curve, or a few scattered specks, and forcing
// them into one box means either editing in many passes or catching
// neighbors you didn't want to touch. A set lets Shift build up any shape.
let editorSelection = new Set(); // keys "gx,gy" in FINAL grid coords
let editorSourceScale = 1;

const cellKey = (gx, gy) => `${gx},${gy}`;

function selectionBounds(sel) {
  if (!sel.size) return null;
  let gx0 = Infinity, gy0 = Infinity, gx1 = -Infinity, gy1 = -Infinity;
  for (const k of sel) {
    const [gx, gy] = k.split(",").map(Number);
    if (gx < gx0) gx0 = gx;
    if (gy < gy0) gy0 = gy;
    if (gx > gx1) gx1 = gx;
    if (gy > gy1) gy1 = gy;
  }
  return { gx0, gy0, gx1: gx1 + 1, gy1: gy1 + 1 };
}

// Converts a click on either pattern canvas (main preview or the editor's
// own) into a grid cell, accounting for the CSS zoom/display scale each one
// is currently rendered at. `clamp` keeps a drag that runs off the edge of
// the board selecting up to the edge instead of snapping back to the anchor.
function patternCellFromEvent(evt, canvasEl, clampToGrid = false) {
  if (!lastPattern) return null;
  const rect = canvasEl.getBoundingClientRect();
  // Subtract the number gutter: the board no longer starts at canvas 0,0.
  const px = ((evt.clientX - rect.left) * canvasEl.width) / rect.width - GUTTER_PX;
  const py = ((evt.clientY - rect.top) * canvasEl.height) / rect.height - GUTTER_PX;
  const offsetX = Math.floor((boardW - lastPattern.gridW) / 2);
  const offsetY = Math.floor((boardH - lastPattern.gridH) / 2);
  let gx = Math.floor(px / CELL_PX) - offsetX;
  let gy = Math.floor(py / CELL_PX) - offsetY;
  if (clampToGrid) {
    gx = clamp(gx, 0, lastPattern.gridW - 1);
    gy = clamp(gy, 0, lastPattern.gridH - 1);
    return { gx, gy };
  }
  if (gx < 0 || gx >= lastPattern.gridW || gy < 0 || gy >= lastPattern.gridH) return null;
  return { gx, gy };
}

// ---------- Drag/Shift selection engine (shared by both canvases) ----------
// Plain drag  : replaces the selection with the dragged box
// Shift+drag  : adds the dragged box to whatever was already selected
// Shift+click : toggles that one cell, for pixel-level touch-ups
// Plain click : replaces the selection with that one cell

let selectDrag = null; // {canvasEl, onCommit, redraw, anchor, cur, base, additive, moved}

function dragSelection() {
  if (!selectDrag) return editorSelection;
  const out = new Set(selectDrag.base);
  const { anchor, cur } = selectDrag;
  const gx0 = Math.min(anchor.gx, cur.gx), gx1 = Math.max(anchor.gx, cur.gx);
  const gy0 = Math.min(anchor.gy, cur.gy), gy1 = Math.max(anchor.gy, cur.gy);
  // A shift+click that never moved is a toggle, not a one-cell add — that's
  // the only way to take a cell back out of the selection.
  if (selectDrag.additive && !selectDrag.moved) {
    const k = cellKey(anchor.gx, anchor.gy);
    if (out.has(k)) out.delete(k); else out.add(k);
    return out;
  }
  for (let gy = gy0; gy <= gy1; gy++) {
    for (let gx = gx0; gx <= gx1; gx++) out.add(cellKey(gx, gy));
  }
  return out;
}

function bindPatternSelect(canvasEl, onCommit, redraw) {
  canvasEl.addEventListener("mousedown", (evt) => {
    const cell = patternCellFromEvent(evt, canvasEl);
    if (!cell) return;
    evt.preventDefault(); // don't start a native text/image drag mid-selection
    selectDrag = {
      canvasEl, onCommit, redraw,
      anchor: cell, cur: cell, moved: false,
      additive: evt.shiftKey,
      base: evt.shiftKey ? new Set(editorSelection) : new Set(),
    };
    redraw();
  });
}

window.addEventListener("mousemove", (evt) => {
  if (!selectDrag) return;
  const cell = patternCellFromEvent(evt, selectDrag.canvasEl, true);
  if (!cell) return;
  if (cell.gx !== selectDrag.cur.gx || cell.gy !== selectDrag.cur.gy) {
    selectDrag.cur = cell;
    selectDrag.moved = true;
    selectDrag.redraw();
  }
});

window.addEventListener("mouseup", () => {
  if (!selectDrag) return;
  const { onCommit, moved, additive, anchor, canvasEl } = selectDrag;

  // On the MAIN preview a plain click (no drag, no Shift) means "tell me
  // about this color" rather than "edit this one cell" — you click a bead to
  // light up every other bead of the same color. Dragging still means edit,
  // and Shift still means build a selection, so nothing is taken away.
  if (canvasEl === patternCanvas && !moved && !additive) {
    selectDrag = null;
    editorSelection = new Set();
    const cell = lastPattern && lastPattern.cells[anchor.gy] && lastPattern.cells[anchor.gy][anchor.gx];
    setHighlight(cell ? cell.index : null);
    return;
  }

  const sel = dragSelection();
  selectDrag = null;
  editorSelection = sel;
  onCommit(sel);
});

bindPatternSelect(patternCanvas, () => openCellEditor(), () => {
  renderPattern(lastPattern);
  drawSelectionOverlay(patternCanvas, dragSelection());
});
bindPatternSelect(editorPatternCanvas, () => {
  renderEditorPatternCanvas();
  renderEditorRecommendations();
  updateEditorSelectionInfo();
}, () => renderEditorPatternCanvas());

// Outlines an arbitrarily-shaped selection: a translucent wash over every
// selected cell, plus a border stroked only along edges that face an
// UNselected cell. Stroking each cell's full box instead would draw a grid
// of internal lines over the region and make a large selection unreadable.
function drawSelectionOverlay(canvasEl, sel) {
  if (!lastPattern || !sel || !sel.size) return;
  const ctx = canvasEl.getContext("2d");
  const offsetX = Math.floor((boardW - lastPattern.gridW) / 2);
  const offsetY = Math.floor((boardH - lastPattern.gridH) / 2);
  const px = (gx) => GUTTER_PX + (offsetX + gx) * CELL_PX;
  const py = (gy) => GUTTER_PX + (offsetY + gy) * CELL_PX;

  ctx.save();
  ctx.fillStyle = "rgba(232, 89, 12, 0.28)";
  for (const k of sel) {
    const [gx, gy] = k.split(",").map(Number);
    ctx.fillRect(px(gx), py(gy), CELL_PX, CELL_PX);
  }
  ctx.strokeStyle = "#e8590c";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  for (const k of sel) {
    const [gx, gy] = k.split(",").map(Number);
    const x = px(gx), y = py(gy);
    if (!sel.has(cellKey(gx, gy - 1))) { ctx.moveTo(x, y); ctx.lineTo(x + CELL_PX, y); }
    if (!sel.has(cellKey(gx, gy + 1))) { ctx.moveTo(x, y + CELL_PX); ctx.lineTo(x + CELL_PX, y + CELL_PX); }
    if (!sel.has(cellKey(gx - 1, gy))) { ctx.moveTo(x, y); ctx.lineTo(x, y + CELL_PX); }
    if (!sel.has(cellKey(gx + 1, gy))) { ctx.moveTo(x + CELL_PX, y); ctx.lineTo(x + CELL_PX, y + CELL_PX); }
  }
  ctx.stroke();
  ctx.restore();
}

// Three ways in, because the obvious one had to be given up: a plain click
// on the preview now highlights a color, so it can no longer also open the
// editor. Dragging alone would leave the editor effectively undiscoverable —
// nobody drags across a chart to find out what happens.
patternCanvas.addEventListener("dblclick", (evt) => {
  const cell = patternCellFromEvent(evt, patternCanvas);
  if (!cell) return;
  highlightIndex = null;
  editorSelection = new Set([cellKey(cell.gx, cell.gy)]);
  renderPattern(lastPattern);
  renderUsage(lastPattern);
  updateHighlightInfo();
  openCellEditor();
});

function openCellEditor() {
  if (!lastPattern || !sourceImage) return;
  cellEditor.hidden = false;
  renderEditorSourceCanvas();
  renderEditorPatternCanvas();
  renderEditorRecommendations();
  updateEditorSelectionInfo();
}

bindIfPresent("open-editor", "click", () => openCellEditor());

editorExitBtn.addEventListener("click", () => {
  cellEditor.hidden = true;
  editorSelection = new Set();
  if (lastPattern) renderPattern(lastPattern);
});

// Esc closes the editor, Ctrl/Cmd+A selects the whole pattern — both are what
// you reach for reflexively once the editor feels like a real tool.
window.addEventListener("keydown", (evt) => {
  if (cellEditor.hidden) return;
  if (evt.key === "Escape") {
    editorExitBtn.click();
  } else if (evt.key === "+" || evt.key === "=") {
    evt.preventDefault();
    setEditorZoom((editorZoom ?? editorFitZoom()) * 1.25);
  } else if (evt.key === "-" || evt.key === "_") {
    evt.preventDefault();
    setEditorZoom((editorZoom ?? editorFitZoom()) / 1.25);
  } else if (evt.key === "0") {
    evt.preventDefault();
    editorZoom = null;
    applyEditorZoom();
  } else if ((evt.metaKey || evt.ctrlKey) && evt.key.toLowerCase() === "a") {
    evt.preventDefault();
    editorSelection = new Set();
    for (let gy = 0; gy < lastPattern.gridH; gy++) {
      for (let gx = 0; gx < lastPattern.gridW; gx++) editorSelection.add(cellKey(gx, gy));
    }
    renderEditorPatternCanvas();
    renderEditorRecommendations();
    updateEditorSelectionInfo();
  }
});

function renderEditorSourceCanvas() {
  const maxW = Math.min(720, (editorSourceCanvas.parentElement.clientWidth || 400) - 4);
  editorSourceScale = Math.min(6, maxW / sourceImage.naturalWidth);
  editorSourceCanvas.width = Math.round(sourceImage.naturalWidth * editorSourceScale);
  editorSourceCanvas.height = Math.round(sourceImage.naturalHeight * editorSourceScale);
  editorSourceCanvas.getContext("2d").drawImage(sourceImage, 0, 0, editorSourceCanvas.width, editorSourceCanvas.height);
}

// Eyedropper: every click on the original-image panel samples that exact
// source pixel and applies it straight to whatever cells are selected.
editorSourceCanvas.addEventListener("click", (evt) => {
  if (!editorSelection.size || !sourceFullResCtx) return;
  const rect = editorSourceCanvas.getBoundingClientRect();
  const ox = ((evt.clientX - rect.left) * editorSourceCanvas.width) / rect.width / editorSourceScale;
  const oy = ((evt.clientY - rect.top) * editorSourceCanvas.height) / rect.height / editorSourceScale;
  const x = Math.max(0, Math.min(sourceFullResCtx.canvas.width - 1, Math.round(ox)));
  const y = Math.max(0, Math.min(sourceFullResCtx.canvas.height - 1, Math.round(oy)));
  const [r, g, b] = sourceFullResCtx.getImageData(x, y, 1, 1).data;
  applyColorToSelection(nearestInPalette(r, g, b, scopedPalette()));
});

function renderEditorPatternCanvas() {
  if (!lastPattern) return;
  drawPatternToCanvas(editorPatternCanvas, lastPattern);
  drawSelectionOverlay(editorPatternCanvas, dragSelection());
  applyEditorZoom();
}

// ---------- Editor zoom ----------
// The editor is where you aim at individual cells, so it needs its own zoom
// independent of the main preview's. `null` means "fit the panel" and is
// re-evaluated on every render, so switching board size while the editor is
// open doesn't leave the canvas at a stale scale; once the user zooms
// explicitly, that choice sticks until they hit 适应宽度 again.
const editorPatternWrap = document.getElementById("editor-pattern-wrap");
const editorZoomInBtn = document.getElementById("editor-zoom-in");
const editorZoomOutBtn = document.getElementById("editor-zoom-out");
const editorZoomFitBtn = document.getElementById("editor-zoom-fit");
const editorZoomLabel = document.getElementById("editor-zoom-label");

let editorZoom = null;

function editorFitZoom() {
  const avail = (editorPatternWrap && editorPatternWrap.clientWidth) || 640;
  return clamp((avail - 4) / (editorPatternCanvas.width || 1), 0.1, 8);
}

function applyEditorZoom() {
  const z = editorZoom == null ? editorFitZoom() : editorZoom;
  editorPatternCanvas.style.width = Math.round(editorPatternCanvas.width * z) + "px";
  editorPatternCanvas.style.height = Math.round(editorPatternCanvas.height * z) + "px";
  if (editorZoomLabel) editorZoomLabel.textContent = Math.round(z * 100) + "%";
}

// Zooming around a fixed point (the panel's center, or the cursor for wheel
// zoom) instead of the top-left corner: at high zoom the area you're working
// on would otherwise slide out of view on every step, and you'd have to
// re-find it by scrolling after each click.
function setEditorZoom(next, anchor) {
  const wrap = editorPatternWrap;
  const prev = editorZoom == null ? editorFitZoom() : editorZoom;
  const z = clamp(next, 0.1, 8);
  if (!wrap) { editorZoom = z; applyEditorZoom(); return; }

  const ax = anchor ? anchor.x : wrap.clientWidth / 2;
  const ay = anchor ? anchor.y : wrap.clientHeight / 2;
  // Content coordinate currently under the anchor point.
  const cx = (wrap.scrollLeft + ax) / prev;
  const cy = (wrap.scrollTop + ay) / prev;

  editorZoom = z;
  applyEditorZoom();
  wrap.scrollLeft = cx * z - ax;
  wrap.scrollTop = cy * z - ay;
}

if (editorZoomInBtn) {
  editorZoomInBtn.addEventListener("click", () => setEditorZoom((editorZoom ?? editorFitZoom()) * 1.25));
  editorZoomOutBtn.addEventListener("click", () => setEditorZoom((editorZoom ?? editorFitZoom()) / 1.25));
  editorZoomFitBtn.addEventListener("click", () => { editorZoom = null; applyEditorZoom(); });
}

// Ctrl/Cmd+wheel is the near-universal zoom gesture, and claiming it (rather
// than plain wheel) keeps ordinary scrolling of a tall pattern working.
if (editorPatternWrap) {
  editorPatternWrap.addEventListener("wheel", (evt) => {
    if (!evt.ctrlKey && !evt.metaKey) return;
    evt.preventDefault();
    const rect = editorPatternWrap.getBoundingClientRect();
    const anchor = { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
    const factor = Math.exp(-evt.deltaY * 0.0015);
    setEditorZoom((editorZoom ?? editorFitZoom()) * factor, anchor);
  }, { passive: false });
}

// Every distinct color already placed anywhere in the current pattern —
// restricting candidates to these (instead of all 221 Mard colors) means
// picking one never adds a new color to buy/sort for the piece. Returns
// each with its total cell count (shown as a hint, no longer the sort key).
function computeUsedColorCounts() {
  if (!lastPattern) return [];
  const counts = new Map();
  for (const row of lastPattern.cells) {
    for (const cell of row) {
      if (!cell) continue;
      counts.set(cell.index, (counts.get(cell.index) || 0) + 1);
    }
  }
  return [...counts.entries()].map(([idx, count]) => ({ entry: MARD_PALETTE[idx], count }));
}

// Maps a FINAL-grid cell range back to its ORIGINAL-image-coordinate
// rectangle — the reverse of how computeGrid derived the grid from the
// crop in the first place, so it works for any gridW/gridH lastPattern
// currently has (including the 52-board's downsampled-from-104 grid).
function gridCellsToOriginalRect(gx0, gy0, gx1, gy1, gridW, gridH, crop, allowRect) {
  let { x: sx, y: sy, w: sw, h: sh } = crop;
  if (!allowRect) {
    const side = Math.min(sw, sh);
    sx = sx + (sw - side) / 2;
    sy = sy + (sh - side) / 2;
    sw = side;
    sh = side;
  }
  return {
    x: sx + (gx0 / gridW) * sw,
    y: sy + (gy0 / gridH) * sh,
    w: ((gx1 - gx0) / gridW) * sw,
    h: ((gy1 - gy0) / gridH) * sh,
  };
}

// Votes for each Mard color among the individual pixels in and around the
// selected region (resampled from the full-res source image, expanded by
// half a cell-width/height on every side so neighboring context feeds in
// too). Deliberately NOT a blended average: averaging a region that
// straddles, say, a black/white edge produces a mid-gray that reads as
// closer to white than black, recommending the wrong one even though most
// individual pixels are clearly one or the other. Classifying each pixel to
// its own nearest color first and counting votes keeps that edge's black
// pixels voting for black and white pixels voting for white.
function computeRegionColorVotes(rectOriginal) {
  const marginX = rectOriginal.w * 0.5;
  const marginY = rectOriginal.h * 0.5;
  const expanded = {
    x: rectOriginal.x - marginX,
    y: rectOriginal.y - marginY,
    w: rectOriginal.w + marginX * 2,
    h: rectOriginal.h + marginY * 2,
  };
  const dim = 24;
  const aspect = expanded.h / Math.max(1, expanded.w);
  const dw = dim, dh = Math.max(1, Math.round(dim * aspect));
  const imageData = sampleRegion(sourceImage, expanded, true, dw, dh);
  const indices = quantizeIndices(imageData);
  const votes = new Map();
  for (const idx of indices) votes.set(idx, (votes.get(idx) || 0) + 1);
  return votes;
}

function makeColorSwatch(entry, label, title, isClear) {
  const el = document.createElement("div");
  el.className = "recommend-swatch" + (isClear ? " clear-swatch" : "");
  const box = isClear ? "" : `style="background:${entry.hex}"`;
  el.innerHTML = `<div class="swatch-box" ${box}></div><span>${label}</span>`;
  el.title = title;
  el.addEventListener("click", () => applyColorToSelection(isClear ? null : entry));
  return el;
}

function renderEditorRecommendations() {
  editorRecommendColors.innerHTML = "";
  if (!editorSelection.size || !cropRect || !lastPattern) return;

  editorRecommendColors.appendChild(makeColorSwatch(null, "不放豆", "清除选中格子（不放豆）", true));

  // Colors are ranked by what the source image actually looks like across
  // the selection's BOUNDING BOX, even when the selection itself is a
  // scattered shape. Sampling only the exact chosen cells would miss the
  // surrounding context that makes "which color did this want to be"
  // answerable, and the box is a good enough stand-in for that context.
  const { gx0, gy0, gx1, gy1 } = selectionBounds(editorSelection);
  const rectOriginal = gridCellsToOriginalRect(
    gx0, gy0, gx1, gy1, lastPattern.gridW, lastPattern.gridH, cropRect, allowRectCheckbox.checked
  );
  const votes = computeRegionColorVotes(rectOriginal);

  const ranked = computeUsedColorCounts().sort(
    (a, b) => (votes.get(b.entry.index) || 0) - (votes.get(a.entry.index) || 0)
  );
  for (const { entry, count } of ranked) {
    const localVotes = votes.get(entry.index) || 0;
    editorRecommendColors.appendChild(makeColorSwatch(entry, entry.code, `周围区域 ${localVotes} 处采样匹配 · 图纸中共 ${count} 颗`));
  }
}

function applyColorToSelection(entry) {
  if (!editorSelection.size || !lastPattern) return;
  for (const k of editorSelection) {
    const [gx, gy] = k.split(",").map(Number);
    if (gy < 0 || gy >= lastPattern.gridH || gx < 0 || gx >= lastPattern.gridW) continue;
    lastPattern.cells[gy][gx] = entry;
  }
  renderPattern(lastPattern);
  renderUsage(lastPattern);
  renderEditorPatternCanvas();
  renderEditorRecommendations();
}

// ---------- Mirror ----------
// Flips a region of the pattern in place. Operates on the selection's
// BOUNDING BOX rather than only the selected cells: a mirror is a spatial
// rearrangement, so every cell inside the region has to move for the result
// to look like a reflection — writing only into a scattered subset would
// scramble the region instead of flipping it. With nothing selected it
// mirrors the whole pattern, which is the common case for "I drew this
// facing the wrong way".

function mirrorPattern(axis) {
  if (!lastPattern) return;
  const { gridW, gridH, cells } = lastPattern;
  const b = editorSelection.size
    ? selectionBounds(editorSelection)
    : { gx0: 0, gy0: 0, gx1: gridW, gy1: gridH };
  const gx0 = clamp(b.gx0, 0, gridW), gx1 = clamp(b.gx1, 0, gridW);
  const gy0 = clamp(b.gy0, 0, gridH), gy1 = clamp(b.gy1, 0, gridH);
  const w = gx1 - gx0, h = gy1 - gy0;
  if (w < 1 || h < 1) return;

  // Snapshot first: mirroring in place would otherwise read cells that the
  // same pass has already overwritten, and the second half of the region
  // would come out as a copy of the first rather than its reflection.
  const snap = [];
  for (let gy = gy0; gy < gy1; gy++) snap.push(cells[gy].slice(gx0, gx1));

  for (let gy = gy0; gy < gy1; gy++) {
    for (let gx = gx0; gx < gx1; gx++) {
      const sy = axis === "v" ? h - 1 - (gy - gy0) : gy - gy0;
      const sx = axis === "h" ? w - 1 - (gx - gx0) : gx - gx0;
      cells[gy][gx] = snap[sy][sx];
    }
  }

  renderPattern(lastPattern);
  renderUsage(lastPattern);
  if (!cellEditor.hidden) {
    renderEditorPatternCanvas();
    renderEditorRecommendations();
  }
  return { gx0, gy0, gx1, gy1 };
}

document.getElementById("mirror-h").addEventListener("click", () => mirrorPattern("h"));
document.getElementById("mirror-v").addEventListener("click", () => mirrorPattern("v"));

function updateEditorSelectionInfo() {
  if (!editorSelection.size) {
    editorSelectionInfo.textContent = "未选中格子 · 拖拽框选，按住 Shift 可继续追加";
    return;
  }
  const b = selectionBounds(editorSelection);
  const w = b.gx1 - b.gx0, h = b.gy1 - b.gy0;
  const rect = editorSelection.size === w * h ? `${w}×${h} · ` : "";
  editorSelectionInfo.textContent = `已选中 ${rect}${editorSelection.size} 个格子`;
}

// ---------- Export ----------

exportPngBtn.addEventListener("click", () => {
  if (!lastPattern) return;
  // Export the full chart, never the dimmed single-color view: the highlight
  // is a way of reading the pattern on screen, not a variant of it, and a
  // washed-out PNG with only one color legible is never what someone means
  // by "导出图纸". The on-screen highlight is restored right after.
  const saved = highlightIndex;
  highlightIndex = null;
  renderPattern(lastPattern);
  const url = patternCanvas.toDataURL("image/png");
  highlightIndex = saved;
  renderPattern(lastPattern);

  const a = document.createElement("a");
  a.download = `拼豆图纸_${boardW}x${boardH}.png`;
  a.href = url;
  a.click();
});

exportCsvBtn.addEventListener("click", () => {
  if (!lastPattern) return;
  const { sorted, total } = countBeads(lastPattern.cells);
  let csv = "色号,颗数\n";
  for (const [code, { count }] of sorted) csv += `${code},${count}\n`;
  csv += `合计,${total}\n`;

  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.download = `用豆清单_${boardW}x${boardH}.csv`;
  a.href = URL.createObjectURL(blob);
  a.click();
});
