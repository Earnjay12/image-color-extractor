'use strict';

/* 픽셀 샘플링 → k-means 군집화 → "느낌"에 따른 대표색 선택.
   군집화는 이미지당 한 번만 넉넉하게(K개) 해 두고, 느낌·개수는 그 결과에서 골라낸다.
   그래서 슬라이더를 움직여도 재분석 없이 즉시 반응한다. */

CC.extract = (() => {
  const { rgbToLab, describe, deltaE } = CC.color;

  const SAMPLE_MAX = 256;  // 분석용으로 축소할 최대 변 길이
  const K          = 24;   // 후보 군집 수
  const ITERS      = 30;   // k-means 최대 반복
  const ALPHA_MIN  = 128;  // 이 값 미만의 투명 픽셀은 제외

  /* ---------- 샘플링 ---------- */

  function sample(img) {
    const scale = Math.min(1, SAMPLE_MAX / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));

    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
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
      const L = rgbToLab(r, g, b);
      const o = n * 3;
      lab[o] = L[0]; lab[o + 1] = L[1]; lab[o + 2] = L[2];
      rgb[o] = r; rgb[o + 1] = g; rgb[o + 2] = b;
      n++;
    }
    return { lab, rgb, n };
  }

  /* ---------- k-means (k-means++ 초기화, 시드 고정) ---------- */

  // 같은 이미지는 항상 같은 군집이 나오도록 시드 고정 난수를 쓴다
  function mulberry32(seed) {
    return () => {
      seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function cluster(samples, k = K) {
    const { lab, rgb, n } = samples;
    if (n === 0) return [];
    k = Math.min(k, n);

    const rand = mulberry32(n * 7919 + 17);
    const cx = new Float64Array(k * 3);
    const dist = new Float64Array(n).fill(Infinity);

    const first = Math.floor(rand() * n) * 3;
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
      let target = rand() * sum, pick = n - 1;
      for (let i = 0; i < n; i++) {
        target -= dist[i];
        if (target <= 0) { pick = i; break; }
      }
      const o = pick * 3, cc = c * 3;
      cx[cc] = lab[o]; cx[cc + 1] = lab[o + 1]; cx[cc + 2] = lab[o + 2];
    }

    const assign = new Int32Array(n).fill(-1);
    const sumL = new Float64Array(k), sumA = new Float64Array(k), sumB = new Float64Array(k);
    const count = new Int32Array(k);

    for (let iter = 0; iter < ITERS; iter++) {
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
        if (!count[c]) continue;
        const cc = c * 3;
        cx[cc] = sumL[c] / count[c]; cx[cc + 1] = sumA[c] / count[c]; cx[cc + 2] = sumB[c] / count[c];
      }
      if (!moved) break;
    }

    // 군집 중심에 가장 가까운 "실제 픽셀" 색을 대표색으로 삼는다.
    // 평균값을 그대로 쓰면 이미지에 없는 탁한 색이 나온다.
    const bestIdx = new Int32Array(k).fill(-1);
    const bestDist = new Float64Array(k).fill(Infinity);
    for (let i = 0; i < n; i++) {
      const c = assign[i], cc = c * 3, o = i * 3;
      const dL = lab[o] - cx[cc], dA = lab[o + 1] - cx[cc + 1], dB = lab[o + 2] - cx[cc + 2];
      const d = dL * dL + dA * dA + dB * dB;
      if (d < bestDist[c]) { bestDist[c] = d; bestIdx[c] = i; }
    }

    const byHex = new Map();
    for (let c = 0; c < k; c++) {
      if (!count[c] || bestIdx[c] < 0) continue;
      const o = bestIdx[c] * 3;
      const col = describe(rgb[o], rgb[o + 1], rgb[o + 2]);
      const share = count[c] / n;
      const hit = byHex.get(col.hex);
      if (hit) hit.share += share;
      else byHex.set(col.hex, { ...col, share });
    }
    return [...byHex.values()].sort((a, b) => b.share - a.share);
  }

  /* ---------- 느낌별 선택 ---------- */

  const bell = (x, mu, s) => Math.exp(-((x - mu) * (x - mu)) / (2 * s * s));
  const chromaW = (C, cap) => Math.min(C, cap) / cap;

  // score(c): c.share(면적), c.lab[0](밝기 L), c.C(채도) 로 우선순위를 매긴다.
  // 면적은 제곱근으로 눌러서, 넓은 배경색이 모든 걸 잡아먹지 않게 한다.
  const MOODS = [
    {
      id: 'balanced', label: '균형',
      hint: '이미지에서 가장 넓게 보이는 색부터 고릅니다.',
      score: (c) => c.share,
    },
    {
      id: 'vivid', label: '강렬한',
      hint: '채도가 높고 눈에 확 띄는 색을 우선합니다.',
      score: (c) => Math.pow(c.share, 0.4) * (0.03 + Math.pow(chromaW(c.C, 90), 1.5)),
    },
    {
      id: 'soft', label: '부드러운',
      hint: '채도가 낮고 밝은, 편안한 색을 우선합니다.',
      score: (c) => Math.pow(c.share, 0.35) * (0.03 + bell(c.C, 22, 16) * bell(c.lab[0], 76, 14)),
    },
    {
      id: 'deep', label: '깊은',
      hint: '어둡고 농도가 짙은 색을 우선합니다.',
      score: (c) => Math.pow(c.share, 0.5) * (0.03 + bell(c.lab[0], 30, 15) * (0.35 + chromaW(c.C, 55) * 0.65)),
    },
    {
      id: 'airy', label: '밝은',
      hint: '밝고 가벼운 색을 우선합니다.',
      score: (c) => Math.pow(c.share, 0.5) * (0.03 + bell(c.lab[0], 84, 12) * (0.3 + chromaW(c.C, 40) * 0.7)),
    },
  ];

  /**
   * 점수 순으로 고르되, 이미 고른 색과 너무 비슷하면 건너뛴다(ΔE 기준).
   * 다양성 조건을 점점 풀어 가며 요청한 개수를 채운다.
   */
  function select(clusters, moodId, count) {
    const mood = MOODS.find((m) => m.id === moodId) || MOODS[0];
    const ranked = clusters
      .map((c) => ({ ...c, score: mood.score(c) }))
      .sort((a, b) => b.score - a.score);

    const picked = [];
    for (const minDE of [16, 8, 0]) {
      for (const cand of ranked) {
        if (picked.length >= count) break;
        if (picked.includes(cand)) continue;
        if (picked.every((p) => deltaE(p.lab, cand.lab) >= minDE)) picked.push(cand);
      }
      if (picked.length >= count) break;
    }
    return picked;
  }

  return { sample, cluster, select, MOODS };
})();
