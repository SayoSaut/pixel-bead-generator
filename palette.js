// Mard 拼豆完整色卡 291 色：标准 221 色 (A-H, M 系列) + 扩展 70 色 (P/Q/R/T/Y/ZG)
// 前 221 项为标准色，索引 0-220；扩展色索引 221-290。顺序有意义：
// MARD_STANDARD_COUNT 靠切片区分两档，索引在两档之间保持稳定。
// 来源: https://www.pixel-beads.com/zh/mard-bead-color-chart
// 注意: HEX 为屏幕显示近似值，实体豆颜色可能受光线与批次影响，如有偏差请手动校准。
const MARD_PALETTE = [
  ["A1","#FAF4C8"],["A2","#FFFFD5"],["A3","#FEFF8B"],["A4","#FBED56"],["A5","#F4D738"],
  ["A6","#FEAC4C"],["A7","#FE8B4C"],["A8","#FFDA45"],["A9","#FF995B"],["A10","#F77C31"],
  ["A11","#FFDD99"],["A12","#FE9F72"],["A13","#FFC365"],["A14","#FD543D"],["A15","#FFF365"],
  ["A16","#FFFF9F"],["A17","#FFE36E"],["A18","#FEBE7D"],["A19","#FD7C72"],["A20","#FFD568"],
  ["A21","#FFE395"],["A22","#F4F57D"],["A23","#E6C9B7"],["A24","#F7F8A2"],["A25","#FFD67D"],
  ["A26","#FFC830"],
  ["B1","#E6EE31"],["B2","#63F347"],["B3","#9EF780"],["B4","#5DE035"],["B5","#35E352"],
  ["B6","#65E2A6"],["B7","#3DAF80"],["B8","#1C9C4F"],["B9","#27523A"],["B10","#95D3C2"],
  ["B11","#5D722A"],["B12","#166F41"],["B13","#CAEB7B"],["B14","#ADE946"],["B15","#2E5132"],
  ["B16","#C5ED9C"],["B17","#9BB13A"],["B18","#E6EE49"],["B19","#24B88C"],["B20","#C2F0CC"],
  ["B21","#156A6B"],["B22","#0B3C43"],["B23","#303A21"],["B24","#EEFCA5"],["B25","#4E846D"],
  ["B26","#8D7A35"],["B27","#CCE1AF"],["B28","#9EE5B9"],["B29","#C5E254"],["B30","#E2FCB1"],
  ["B31","#B0E792"],["B32","#9CAB5A"],
  ["C1","#E8FFE7"],["C2","#A9F9FC"],["C3","#A0E2FB"],["C4","#41CCFF"],["C5","#01ACEB"],
  ["C6","#50AAF0"],["C7","#3677D2"],["C8","#0F54C0"],["C9","#324BCA"],["C10","#3EBCE2"],
  ["C11","#28DDDE"],["C12","#1C334D"],["C13","#CDE8FF"],["C14","#D5FDFF"],["C15","#22C4C6"],
  ["C16","#1557A8"],["C17","#04D1F6"],["C18","#1D3344"],["C19","#1887A2"],["C20","#176DAF"],
  ["C21","#BEDDFF"],["C22","#67B4BE"],["C23","#C8E2FF"],["C24","#7CC4FF"],["C25","#A9E5E5"],
  ["C26","#3CAED8"],["C27","#D3DFFA"],["C28","#BBCFED"],["C29","#34488E"],
  ["D1","#AEB4F2"],["D2","#858EDD"],["D3","#2F54AF"],["D4","#182A84"],["D5","#B843C5"],
  ["D6","#AC7BDE"],["D7","#8854B3"],["D8","#E2D3FF"],["D9","#D5B9F8"],["D10","#361851"],
  ["D11","#B9BAE1"],["D12","#DE9AD4"],["D13","#B90095"],["D14","#8B279B"],["D15","#2F1F90"],
  ["D16","#E3E1EE"],["D17","#C4D4F6"],["D18","#A45EC7"],["D19","#D8C3D7"],["D20","#9C32B2"],
  ["D21","#9A009B"],["D22","#333A95"],["D23","#EBDAFC"],["D24","#7786E5"],["D25","#494FC7"],
  ["D26","#DFC2F8"],
  ["E1","#FDD3CC"],["E2","#FEC0DF"],["E3","#FFB7E7"],["E4","#E8649E"],["E5","#F551A2"],
  ["E6","#F13D74"],["E7","#C63478"],["E8","#FFDBE9"],["E9","#E970CC"],["E10","#D33793"],
  ["E11","#FCDDD2"],["E12","#F78FC3"],["E13","#B5006D"],["E14","#FFD1BA"],["E15","#F8C7C9"],
  ["E16","#FFF3EB"],["E17","#FFE2EA"],["E18","#FFC7DB"],["E19","#FEBAD5"],["E20","#D8C7D1"],
  ["E21","#BD9DA1"],["E22","#B785A1"],["E23","#937A8D"],["E24","#E1BCE8"],
  ["F1","#FD957B"],["F2","#FC3D46"],["F3","#F74941"],["F4","#FC283C"],["F5","#E7002F"],
  ["F6","#943630"],["F7","#971937"],["F8","#BC0028"],["F9","#E2677A"],["F10","#8A4526"],
  ["F11","#5A2121"],["F12","#FD4E6A"],["F13","#F35744"],["F14","#FFA9AD"],["F15","#D30022"],
  ["F16","#FEC2A6"],["F17","#E69C79"],["F18","#D37C46"],["F19","#C1444A"],["F20","#CD9391"],
  ["F21","#F7B4C6"],["F22","#FDC0D0"],["F23","#F67E66"],["F24","#E698AA"],["F25","#E54B4F"],
  ["G1","#FFE2CE"],["G2","#FFC4AA"],["G3","#F4C3A5"],["G4","#E1B383"],["G5","#EDB045"],
  ["G6","#E99C17"],["G7","#9D5B3E"],["G8","#753832"],["G9","#E6B483"],["G10","#D98C39"],
  ["G11","#E0C593"],["G12","#FFC890"],["G13","#B7714A"],["G14","#8D614C"],["G15","#FCF9E0"],
  ["G16","#F2D9BA"],["G17","#78524B"],["G18","#FFE4CC"],["G19","#E07935"],["G20","#A94023"],
  ["G21","#B88558"],
  ["H1","#FDFBFF"],["H2","#FEFFFF"],["H3","#B6B1BA"],["H4","#89858C"],["H5","#48464E"],
  ["H6","#2F2B2F"],["H7","#000000"],["H8","#E7D6DB"],["H9","#EDEDED"],["H10","#EEE9EA"],
  ["H11","#CECDD5"],["H12","#FFF5ED"],["H13","#F5ECD2"],["H14","#CFD7D3"],["H15","#98A6A8"],
  ["H16","#1D1414"],["H17","#F1EDED"],["H18","#FFFDF0"],["H19","#F6EFE2"],["H20","#949FA3"],
  ["H21","#FFFBE1"],["H22","#CACAD4"],["H23","#9A9D94"],
  ["M1","#BCC6B8"],["M2","#8AA386"],["M3","#697D80"],["M4","#E3D2BC"],["M5","#D0CCAA"],
  ["M6","#B0A782"],["M7","#B4A497"],["M8","#B38281"],["M9","#A58767"],["M10","#C5B2BC"],
  ["M11","#9F7594"],["M12","#644749"],["M13","#D19066"],["M14","#C77362"],["M15","#757D78"],

  // ---- 扩展 70 色 (P / Q / R / T / Y / ZG 系列) ----
  // 索引接在标准 221 色之后，所以标准色的 index 保持不变 —— 已有图纸和
  // 存下来的色号不会因为开启扩展色而错位。
  ["P1","#FCF8F9"],["P2","#BDA9AB"],["P3","#AEDDA9"],["P4","#FDA49E"],["P5","#EC8D3D"],
  ["P6","#60CFA8"],["P7","#EB9271"],["P8","#F0D958"],["P9","#D9D9D9"],["P10","#D5C8E9"],
  ["P11","#F3ECC8"],["P12","#E6EEF1"],["P13","#A9CBF1"],["P14","#3177B0"],["P15","#668575"],
  ["P16","#FFBE46"],["P17","#FFA324"],["P18","#FEB89F"],["P19","#FFE0E8"],["P20","#FEBECF"],
  ["P21","#ECBEC0"],["P22","#E4A89E"],["P23","#A56269"],
  ["Q1","#F2A5E8"],["Q2","#73B29E"],["Q3","#FFFF00"],["Q4","#FFEBFA"],["Q5","#4F5E5B"],
  ["R1","#D50E21"],["R2","#F92E83"],["R3","#FD8225"],["R4","#F8EC31"],["R5","#34C75B"],
  ["R6","#25B891"],["R7","#17779D"],["R8","#1B60C3"],["R9","#9A56B4"],["R10","#FFDB4D"],
  ["R11","#FFEBFA"],["R12","#D8D5CE"],["R13","#55514C"],["R14","#9EE4DF"],["R15","#77CEE9"],
  ["R16","#3DCFCA"],["R17","#4A867A"],["R18","#7FCD9D"],["R19","#CDE55D"],["R20","#E8C7B4"],
  ["R21","#AD6F3C"],["R22","#6C372F"],["R23","#FEB872"],["R24","#F2C1C0"],["R25","#C9675D"],
  ["R26","#D293BE"],["R27","#EA8CB1"],["R28","#9C87D6"],
  ["T1","#E2DFD7"],
  ["Y1","#FD6FB4"],["Y2","#FEB481"],["Y3","#D7FAA0"],["Y4","#8BDBFA"],["Y5","#E987EA"],
  ["ZG1","#DAABB3"],["ZG2","#D6AA87"],["ZG3","#C1BD8D"],["ZG4","#96869F"],["ZG5","#8490A6"],
  ["ZG6","#94BFE2"],["ZG7","#E2A9D2"],["ZG8","#AB91C0"],
].map(([code, hex], index) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { code, hex, rgb: [r, g, b], lab: rgbToLab(r, g, b), index };
});

// 标准色卡的色号数量。零售套装大多只到这 221 色，扩展系列要单独买，
// 所以默认只用标准色 —— 生成的图纸不会用到你手上没有的豆子。
const MARD_STANDARD_COUNT = 221;

// sRGB -> CIE Lab, used for perceptually-accurate nearest-color matching
function rgbToLab(r, g, b) {
  let [rl, gl, bl] = [r, g, b].map((v) => {
    v /= 255;
    return v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92;
  });
  // sRGB -> XYZ (D65)
  let x = rl * 0.4124 + gl * 0.3576 + bl * 0.1805;
  let y = rl * 0.2126 + gl * 0.7152 + bl * 0.0722;
  let z = rl * 0.0193 + gl * 0.1192 + bl * 0.9505;
  // Normalize by D65 white point
  x /= 0.95047;
  y /= 1.0;
  z /= 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

// Lightness is under-weighted (0.6x) relative to a*/b* (color/chroma) on
// purpose. With all three weighted equally, a target color that sits
// between two palette entries — one gray at nearly the right lightness, one
// colored but at a slightly-off lightness — very often nearest-matches to
// the gray, even though a person looking at the two would say the colored
// one is the far better match. 221 colors isn't dense enough to avoid this
// gap; de-emphasizing lightness recovers hue in exactly that ambiguous
// middle ground. Verified this doesn't pull genuinely neutral or already
// well-matched saturated colors toward the wrong hue.
function labDistance(l1, l2) {
  const dl = l1[0] - l2[0], da = l1[1] - l2[1], db = l1[2] - l2[2];
  return 0.6 * dl * dl + da * da + db * db;
}

// Returns the closest MARD_PALETTE entry to the given RGB color
function nearestMardColor(r, g, b) {
  const targetLab = rgbToLab(r, g, b);
  let best = null;
  let bestDist = Infinity;
  for (const entry of MARD_PALETTE) {
    const d = labDistance(targetLab, entry.lab);
    if (d < bestDist) {
      bestDist = d;
      best = entry;
    }
  }
  return best;
}
