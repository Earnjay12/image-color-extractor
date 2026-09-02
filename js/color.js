'use strict';

/* 색 공간 변환. sRGB ↔ CIELAB(D65), CMYK 근사, 색역(gamut) 보정. */

window.CC = window.CC || {};

CC.color = (() => {
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  const srgbToLinear = (c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const linearToSrgb = (v) =>
    v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;

  function toHex(r, g, b) {
    const h = (v) => v.toString(16).padStart(2, '0');
    return ('#' + h(r) + h(g) + h(b)).toUpperCase();
  }

  /** sRGB → CMYK(%). ICC 프로파일 없는 단순 변환이라 근사값이다. */
  function toCmyk(r, g, b) {
    const R = r / 255, G = g / 255, B = b / 255;
    const k = 1 - Math.max(R, G, B);
    if (k >= 1) return [0, 0, 0, 100];
    const d = 1 - k;
    return [
      Math.round(((1 - R - k) / d) * 100),
      Math.round(((1 - G - k) / d) * 100),
      Math.round(((1 - B - k) / d) * 100),
      Math.round(k * 100),
    ];
  }

  // D65 백색점
  const WX = 0.95047, WZ = 1.08883;
  const F = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const FINV = (t) => {
    const t3 = t * t * t;
    return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787;
  };

  function rgbToLab(r, g, b) {
    const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b);
    const x = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / WX;
    const y =  R * 0.2126729 + G * 0.7151522 + B * 0.0721750;
    const z = (R * 0.0193339 + G * 0.1191920 + B * 0.9503041) / WZ;
    const fx = F(x), fy = F(y), fz = F(z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }

  function labToLinear(L, a, b) {
    const fy = (L + 16) / 116;
    const fx = a / 500 + fy;
    const fz = fy - b / 200;
    const x = WX * FINV(fx), y = FINV(fy), z = WZ * FINV(fz);
    return [
       3.2404542 * x - 1.5371385 * y - 0.4985314 * z,
      -0.9692660 * x + 1.8760108 * y + 0.0415560 * z,
       0.0556434 * x - 0.2040259 * y + 1.0572252 * z,
    ];
  }

  const inGamut = (lin) => lin.every((v) => v >= -0.0005 && v <= 1.0005);

  const linToInts = (lin) =>
    lin.map((v) => Math.round(clamp(linearToSrgb(clamp(v, 0, 1)), 0, 1) * 255));

  /**
   * Lab → sRGB. 색역을 벗어나면 밝기와 색상은 유지한 채 채도만 줄여서
   * 표현 가능한 가장 가까운 색을 돌려준다. (단순 클리핑은 색상이 틀어진다)
   */
  function labToRgbSafe(L, a, b) {
    L = clamp(L, 0, 100);
    let lin = labToLinear(L, a, b);
    if (inGamut(lin)) return finish(L, a, b, lin);

    let lo = 0, hi = 1;
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(labToLinear(L, a * mid, b * mid))) lo = mid; else hi = mid;
    }
    lin = labToLinear(L, a * lo, b * lo);
    return finish(L, a * lo, b * lo, lin);
  }

  function finish(L, a, b, lin) {
    const [r, g, bl] = linToInts(lin);
    return { r, g, b: bl, lab: [L, a, b] };
  }

  const chroma = (a, b) => Math.sqrt(a * a + b * b);

  const deltaE = (p, q) => {
    const dL = p[0] - q[0], dA = p[1] - q[1], dB = p[2] - q[2];
    return Math.sqrt(dL * dL + dA * dA + dB * dB);
  };

  /** 스와치 위 글자색 — 배경 밝기에 따라 검정/흰색. */
  function readableOn(r, g, b) {
    const lum = 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
    return lum > 0.36 ? 'rgba(0,0,0,.66)' : 'rgba(255,255,255,.78)';
  }

  /** r,g,b 정수로 화면·내보내기에서 쓰는 전체 표현을 만든다. */
  function describe(r, g, b) {
    const lab = rgbToLab(r, g, b);
    return { r, g, b, hex: toHex(r, g, b), cmyk: toCmyk(r, g, b), lab, C: chroma(lab[1], lab[2]) };
  }

  return { toHex, toCmyk, rgbToLab, labToRgbSafe, chroma, deltaE, readableOn, describe, clamp };
})();
