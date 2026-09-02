'use strict';

/* =========================================================
   Color Chip — 이미지에서 대표 색상을 추출해 컬러칩으로 보여준다.
   외부 라이브러리 없음. index.html 을 그대로 열어도 동작한다.
   ========================================================= */

const SAMPLE_MAX   = 256;  // 분석용으로 축소할 최대 변 길이
const KMEANS_ITERS = 30;   // k-means 최대 반복
const ALPHA_MIN    = 128;  // 이 값 미만의 투명 픽셀은 분석에서 제외

const $ = (id) => document.getElementById(id);

const dropzone    = $('dropzone');
const fileInput   = $('fileInput');
const workspace   = $('workspace');
const previewImg  = $('previewImg');
const fileMeta    = $('fileMeta');
const replaceBtn  = $('replaceBtn');
const countRange  = $('countRange');
const countOut    = $('countOut');
const paletteEl   = $('palette');
const statusEl    = $('status');
const downloadBtn = $('downloadBtn');
const toastEl     = $('toast');

const state = {
  image: null,      // HTMLImageElement (원본 크기)
  objectUrl: null,  // 해제 대상
  fileName: '',
  samples: null,    // { lab: Float32Array, rgb: Uint8Array, n }
  colors: [],       // [{ r, g, b, hex, rgb, cmyk, share }]
};

/* =========================================================
   1. 색 공간 변환
   ========================================================= */

function toHex(r, g, b) {
  const h = (v) => v.toString(16).padStart(2, '0');
  return ('#' + h(r) + h(g) + h(b)).toUpperCase();
}

/** sRGB → CMYK(%). ICC 프로파일을 쓰지 않는 단순 변환이라 근사값이다. */
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

const srgbToLinear = (c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};

/** sRGB → CIELAB(D65). 사람 눈이 느끼는 색 차이에 가깝게 묶기 위해 사용한다. */
function toLab(r, g, b) {
  const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b);

  const x = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
  const y = (R * 0.2126729 + G * 0.7151522 + B * 0.0721750) / 1.00000;
  const z = (R * 0.0193339 + G * 0.1191920 + B * 0.9503041) / 1.08883;

  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x), fy = f(y), fz = f(z);

  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** 스와치 위에 올릴 글자색 — 배경 밝기에 따라 검정/흰색. */
function readableOn(r, g, b) {
  const lum = 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
  return lum > 0.36 ? 'rgba(0,0,0,.62)' : 'rgba(255,255,255,.72)';
}

/* =========================================================
   2. 픽셀 샘플링
   ========================================================= */

function sampleImage(img) {
  const scale = Math.min(1, SAMPLE_MAX / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));

  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);

  const data = ctx.getImageData(0, 0, w, h).data;
  const total = w * h;

  const lab = new Float32Array(total * 3);
  const rgb = new Uint8Array(total * 3);
  let n = 0;

  for (let i = 0; i < total; i++) {
    const p = i * 4;
    if (data[p + 3] < ALPHA_MIN) continue;
    const r = data[p], g = data[p + 1], b = data[p + 2];
    const L = toLab(r, g, b);
    const o = n * 3;
    lab[o] = L[0]; lab[o + 1] = L[1]; lab[o + 2] = L[2];
    rgb[o] = r; rgb[o + 1] = g; rgb[o + 2] = b;
    n++;
  }

  return { lab, rgb, n };
}

/* =========================================================
   3. k-means 클러스터링 (k-means++ 초기화)
   ========================================================= */

function kmeans(samples, k) {
  const { lab, n } = samples;
  if (n === 0) return [];
  k = Math.min(k, n);

  const cx = new Float64Array(k * 3);
  const dist = new Float64Array(n).fill(Infinity);

  // --- k-means++ 로 시드를 서로 멀리 떨어뜨려 잡는다
  const first = Math.floor(Math.random() * n) * 3;
  cx[0] = lab[first]; cx[1] = lab[first + 1]; cx[2] = lab[first + 2];

  for (let c = 1; c < k; c++) {
    let sum = 0;
    const pc = (c - 1) * 3;
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      const dL = lab[o] - cx[pc], dA = lab[o + 1] - cx[pc + 1], dB = lab[o + 2] - cx[pc + 2];
      const d = dL * dL + dA * dA + dB * dB;
      if (d < dist[i]) dist[i] = d;
      sum += dist[i];
    }
    let target = Math.random() * sum;
    let pick = n - 1;
    for (let i = 0; i < n; i++) {
      target -= dist[i];
      if (target <= 0) { pick = i; break; }
    }
    const o = pick * 3, cc = c * 3;
    cx[cc] = lab[o]; cx[cc + 1] = lab[o + 1]; cx[cc + 2] = lab[o + 2];
  }

  // --- 반복: 할당 → 중심 갱신
  const assign = new Int32Array(n).fill(-1);
  const sumL = new Float64Array(k), sumA = new Float64Array(k), sumB = new Float64Array(k);
  const count = new Int32Array(k);

  for (let iter = 0; iter < KMEANS_ITERS; iter++) {
    let moved = 0;
    sumL.fill(0); sumA.fill(0); sumB.fill(0); count.fill(0);

    for (let i = 0; i < n; i++) {
      const o = i * 3;
      const L = lab[o], A = lab[o + 1], B = lab[o + 2];
      let best = 0, bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const cc = c * 3;
        const dL = L - cx[cc], dA = A - cx[cc + 1], dB = B - cx[cc + 2];
        const d = dL * dL + dA * dA + dB * dB;
        if (d < bestD) { bestD = d; best = c; }
      }
      if (assign[i] !== best) { assign[i] = best; moved++; }
      sumL[best] += L; sumA[best] += A; sumB[best] += B; count[best]++;
    }

    for (let c = 0; c < k; c++) {
      if (count[c] === 0) continue;
      const cc = c * 3;
      cx[cc] = sumL[c] / count[c];
      cx[cc + 1] = sumA[c] / count[c];
      cx[cc + 2] = sumB[c] / count[c];
    }

    if (moved === 0) break;
  }

  // --- 각 군집의 중심에 가장 가까운 "실제 픽셀" 색을 대표색으로 삼는다.
  //     평균값을 그대로 쓰면 이미지에 없는 탁한 색이 나오기 때문.
  const bestIdx = new Int32Array(k).fill(-1);
  const bestDist = new Float64Array(k).fill(Infinity);

  for (let i = 0; i < n; i++) {
    const c = assign[i], cc = c * 3, o = i * 3;
    const dL = lab[o] - cx[cc], dA = lab[o + 1] - cx[cc + 1], dB = lab[o + 2] - cx[cc + 2];
    const d = dL * dL + dA * dA + dB * dB;
    if (d < bestDist[c]) { bestDist[c] = d; bestIdx[c] = i; }
  }

  const out = [];
  for (let c = 0; c < k; c++) {
    if (count[c] === 0 || bestIdx[c] < 0) continue;
    const o = bestIdx[c] * 3;
    out.push({
      r: samples.rgb[o],
      g: samples.rgb[o + 1],
      b: samples.rgb[o + 2],
      share: count[c] / n,
    });
  }

  // 차지하는 면적이 큰 색 = 가장 대표적인 색 순으로 정렬
  out.sort((a, b) => b.share - a.share);
  return out;
}

function extract(samples, k) {
  const raw = kmeans(samples, k);

  // 같은 색으로 수렴한 군집은 하나로 합친다
  const merged = [];
  const seen = new Map();

  for (const c of raw) {
    const hex = toHex(c.r, c.g, c.b);
    const hit = seen.get(hex);
    if (hit) {
      hit.share += c.share;
    } else {
      const entry = {
        r: c.r, g: c.g, b: c.b, hex,
        cmyk: toCmyk(c.r, c.g, c.b),
        share: c.share,
      };
      seen.set(hex, entry);
      merged.push(entry);
    }
  }

  merged.sort((a, b) => b.share - a.share);
  return merged;
}

/* =========================================================
   4. 화면 렌더링
   ========================================================= */

function renderPalette() {
  paletteEl.innerHTML = '';

  for (const c of state.colors) {
    const li = document.createElement('li');
    li.className = 'chip';

    const swatch = document.createElement('div');
    swatch.className = 'chip-swatch';
    swatch.style.background = c.hex;

    const share = document.createElement('span');
    share.className = 'share';
    share.style.color = readableOn(c.r, c.g, c.b);
    share.textContent = (c.share * 100).toFixed(1) + '%';
    swatch.appendChild(share);

    const codes = document.createElement('div');
    codes.className = 'codes';
    codes.append(
      codeRow('HEX', c.hex, c.hex),
      codeRow('RGB', c.r + ', ' + c.g + ', ' + c.b, 'rgb(' + c.r + ', ' + c.g + ', ' + c.b + ')'),
      codeRow('CMYK', cmykLabel(c.cmyk), c.cmyk.join(', ')),
    );

    li.append(swatch, codes);
    paletteEl.appendChild(li);
  }
}

function cmykLabel(c) {
  return 'C ' + c[0] + '  M ' + c[1] + '  Y ' + c[2] + '  K ' + c[3];
}

function codeRow(label, shown, copyValue) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'code';
  btn.title = label + ' 복사';

  const l = document.createElement('span');
  l.className = 'label';
  l.textContent = label;

  const v = document.createElement('span');
  v.className = 'value';
  v.textContent = shown;

  btn.append(l, v);
  btn.addEventListener('click', () => copy(copyValue, label + ' 복사됨 · ' + copyValue));
  return btn;
}

async function copy(text, message) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {
    // 클립보드 API 를 쓸 수 없는 환경용 대체 경로
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* 무시 */ }
    ta.remove();
  }
  showToast(message);
}

let toastTimer = null;
function showToast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 1800);
}

function setStatus(text) {
  if (text) {
    statusEl.textContent = text;
    statusEl.hidden = false;
  } else {
    statusEl.textContent = '';
    statusEl.hidden = true;
  }
}

/* =========================================================
   5. 흐름 제어
   ========================================================= */

function analyze() {
  if (!state.samples) return;

  const requested = Number(countRange.value);
  downloadBtn.disabled = true;
  setStatus('색상을 분석하는 중…');

  // 무거운 동기 작업이므로 한 틱 양보해 "분석 중" 문구를 먼저 그린다.
  // (rAF 는 백그라운드 탭에서 멈추므로 setTimeout 을 쓴다)
  setTimeout(() => {
    state.colors = extract(state.samples, requested);

    renderPalette();
    downloadBtn.disabled = state.colors.length === 0;

    if (state.colors.length === 0) {
      setStatus('분석할 수 있는 픽셀이 없습니다. 다른 이미지를 올려 보세요.');
    } else if (state.colors.length < requested) {
      setStatus('이미지에 뚜렷이 구분되는 색이 ' + state.colors.length + '개뿐이라 그만큼만 추출했습니다.');
    } else {
      setStatus('');
    }
  }, 16);
}

function loadFile(file) {
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    showToast('이미지 파일만 올릴 수 있습니다.');
    return;
  }

  const url = URL.createObjectURL(file);
  const img = new Image();

  img.onload = () => {
    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = url;
    state.image = img;
    state.fileName = file.name || 'image';
    state.samples = sampleImage(img);

    previewImg.src = url;
    fileMeta.textContent = state.fileName + ' · ' + img.naturalWidth + ' × ' + img.naturalHeight + 'px';

    dropzone.hidden = true;
    workspace.hidden = false;

    analyze();
  };

  img.onerror = () => {
    URL.revokeObjectURL(url);
    showToast('이미지를 읽지 못했습니다. 파일이 손상되지 않았는지 확인해 주세요.');
  };

  img.src = url;
}

/* =========================================================
   6. PNG 내보내기 — 원본 이미지와 컬러칩을 한 장에 담는다
   ========================================================= */

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function buildSheet() {
  const SHEET_W   = 1280;
  const PAD       = 56;
  const GAP       = 20;
  const IMG_MAX_H = 640;
  const SWATCH_H  = 116;
  const CHIP_H    = SWATCH_H + 104;
  const SANS = '"Segoe UI", system-ui, -apple-system, "Malgun Gothic", sans-serif';
  const MONO = 'Consolas, ui-monospace, Menlo, monospace';

  const contentW = SHEET_W - PAD * 2;
  const img = state.image;
  const colors = state.colors;

  // 이미지 배치 — 확대는 하지 않고 축소만 한다
  const scale = Math.min(contentW / img.naturalWidth, IMG_MAX_H / img.naturalHeight, 1);
  const drawW = Math.round(img.naturalWidth * scale);
  const drawH = Math.round(img.naturalHeight * scale);

  // 칩 격자 — 행 수를 최소로 잡은 뒤, 마지막 행이 덜 비도록 열 수를 다시 나눈다
  let cols = Math.min(6, colors.length);
  const rows = Math.ceil(colors.length / cols);
  cols = Math.ceil(colors.length / rows);
  const chipW = (contentW - GAP * (cols - 1)) / cols;

  const headerH = 78;
  const gridH   = rows * CHIP_H + (rows - 1) * GAP;
  const footerH = 34;
  const SHEET_H = PAD + headerH + drawH + 44 + gridH + 28 + footerH + PAD;

  const cv = document.createElement('canvas');
  cv.width = SHEET_W;
  cv.height = SHEET_H;
  const ctx = cv.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, SHEET_W, SHEET_H);
  ctx.textBaseline = 'alphabetic';

  // --- 헤더
  let y = PAD;
  ctx.fillStyle = '#1c1c1a';
  ctx.font = '600 26px ' + SANS;
  ctx.fillText(state.fileName, PAD, y + 24);

  ctx.fillStyle = '#8a8a84';
  ctx.font = '15px ' + SANS;
  const stamp = new Date().toLocaleDateString('ko-KR');
  ctx.fillText(
    '컬러칩 ' + colors.length + '개 · ' + img.naturalWidth + ' × ' + img.naturalHeight + 'px · ' + stamp,
    PAD, y + 50
  );
  y += headerH;

  // --- 이미지
  const imgX = PAD + Math.round((contentW - drawW) / 2);
  ctx.save();
  roundRect(ctx, imgX, y, drawW, drawH, 8);
  ctx.clip();
  ctx.drawImage(img, imgX, y, drawW, drawH);
  ctx.restore();

  ctx.strokeStyle = 'rgba(0,0,0,.10)';
  ctx.lineWidth = 1;
  roundRect(ctx, imgX + 0.5, y + 0.5, drawW - 1, drawH - 1, 8);
  ctx.stroke();
  y += drawH + 44;

  // --- 컬러칩
  colors.forEach((c, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = PAD + col * (chipW + GAP);
    const cy = y + row * (CHIP_H + GAP);

    ctx.fillStyle = c.hex;
    roundRect(ctx, x, cy, chipW, SWATCH_H, 8);
    ctx.fill();

    ctx.strokeStyle = 'rgba(0,0,0,.10)';
    ctx.lineWidth = 1;
    roundRect(ctx, x + 0.5, cy + 0.5, chipW - 1, SWATCH_H - 1, 8);
    ctx.stroke();

    ctx.fillStyle = readableOn(c.r, c.g, c.b);
    ctx.font = '600 13px ' + MONO;
    ctx.fillText((c.share * 100).toFixed(1) + '%', x + 12, cy + SWATCH_H - 12);

    let ty = cy + SWATCH_H + 26;
    ctx.fillStyle = '#1c1c1a';
    ctx.font = '600 19px ' + MONO;
    ctx.fillText(c.hex, x, ty);

    ctx.fillStyle = '#55554f';
    ctx.font = '14px ' + MONO;
    ty += 24;
    ctx.fillText('RGB  ' + c.r + ', ' + c.g + ', ' + c.b, x, ty);
    ty += 21;
    ctx.fillText('CMYK ' + c.cmyk[0] + ', ' + c.cmyk[1] + ', ' + c.cmyk[2] + ', ' + c.cmyk[3], x, ty);
  });
  y += gridH + 28;

  // --- 푸터
  ctx.fillStyle = '#a3a39c';
  ctx.font = '13px ' + SANS;
  ctx.fillText('CMYK 값은 ICC 프로파일 없이 계산한 근사값입니다. · Color Chip', PAD, y + 16);

  return cv;
}

function download() {
  if (!state.image || state.colors.length === 0) return;

  const cv = buildSheet();
  const base = state.fileName.replace(/\.[^.]+$/, '') || 'image';

  cv.toBlob((blob) => {
    if (!blob) { showToast('이미지를 만들지 못했습니다.'); return; }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = base + '-palette.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('다운로드를 시작했습니다.');
  }, 'image/png');
}

/* =========================================================
   7. 이벤트 연결
   ========================================================= */

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
});
replaceBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', () => {
  loadFile(fileInput.files[0]);
  fileInput.value = ''; // 같은 파일을 다시 골라도 change 가 뜨도록
});

['dragenter', 'dragover'].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  })
);
['dragleave', 'drop'].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
  })
);
dropzone.addEventListener('drop', (e) => loadFile(e.dataTransfer.files[0]));

// 페이지 어디에 떨어뜨려도, 어디서 붙여넣어도 받는다
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  if (e.dataTransfer && e.dataTransfer.files.length) loadFile(e.dataTransfer.files[0]);
});
window.addEventListener('paste', (e) => {
  const items = e.clipboardData ? Array.from(e.clipboardData.items) : [];
  const item = items.find((i) => i.type.startsWith('image/'));
  if (item) loadFile(item.getAsFile());
});

countRange.addEventListener('input', () => { countOut.textContent = countRange.value; });
countRange.addEventListener('change', analyze);

downloadBtn.addEventListener('click', download);
