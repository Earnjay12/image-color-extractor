'use strict';

/* 색 보정. 뽑힌 컬러칩에 톤/화풍 프리셋과 미세조정을 Lab 공간에서 적용한다.
   화풍 프리셋은 그 화가의 색 경향에서 영감을 얻은 해석이지 복원이 아니다. */

CC.grade = (() => {
  const { labToRgbSafe, describe } = CC.color;

  /* 파라미터
     lT / lA : 밝기 L 을 lT 쪽으로 lA 비율만큼 끌어당김
     c       : 채도 배율
     a / b   : Lab a(초록↔빨강), b(파랑↔노랑) 축 이동
     con     : L=50 을 기준으로 한 명암 대비 배율                       */
  const PRESETS = [
    // ---- 톤
    { id: 'none',   group: 'tone', label: '원본',   hint: '보정을 적용하지 않습니다.', p: {} },
    { id: 'pastel', group: 'tone', label: '파스텔', hint: '밝고 옅게. 채도를 낮추고 밝기를 올립니다.', p: { lT: 84, lA: 0.6, c: 0.5 } },
    { id: 'muted',  group: 'tone', label: '뮤트',   hint: '채도를 낮춰 차분하게.', p: { lT: 60, lA: 0.15, c: 0.6 } },
    { id: 'vivid',  group: 'tone', label: '비비드', hint: '채도와 대비를 끌어올려 선명하게.', p: { c: 1.4, con: 1.1 } },
    { id: 'film',   group: 'tone', label: '필름',   hint: '따뜻하고 살짝 바랜 아날로그 톤.', p: { lT: 58, lA: 0.25, c: 0.8, a: 3, b: 9 } },
    { id: 'mono',   group: 'tone', label: '모노',   hint: '색을 거의 빼고 명암만 남깁니다.', p: { c: 0.08 } },

    // ---- 화풍
    { id: 'monet',   group: 'art', label: '모네',    hint: '인상파 · 빛을 머금은 옅고 서늘한 색.', p: { lT: 76, lA: 0.45, c: 0.78, b: -5 } },
    { id: 'vangogh', group: 'art', label: '반 고흐', hint: '후기 인상파 · 노랑과 파랑의 강한 대비.', p: { c: 1.3, b: 8, con: 1.15 } },
    { id: 'matisse', group: 'art', label: '마티스',  hint: '야수파 · 원색에 가까운 평면적인 색.', p: { c: 1.55, lT: 55, lA: 0.15 } },
    { id: 'morandi', group: 'art', label: '모란디',  hint: '회색이 섞인 차분하고 뿌연 중간 톤.', p: { lT: 68, lA: 0.5, c: 0.35, b: 3 } },
    { id: 'klimt',   group: 'art', label: '클림트',  hint: '금빛 · 따뜻한 황금색이 감돕니다.', p: { c: 1.1, a: 5, b: 18, lT: 58, lA: 0.2 } },
    { id: 'hopper',  group: 'art', label: '호퍼',    hint: '차가운 빛과 짙은 그림자의 대비.', p: { c: 0.85, b: -6, con: 1.25 } },
    { id: 'rothko',  group: 'art', label: '로스코',  hint: '깊고 무거운 색면.', p: { lT: 38, lA: 0.4, c: 1.15, a: 4 } },
    { id: 'hokusai', group: 'art', label: '호쿠사이', hint: '우키요에 · 남색이 감도는 절제된 색.', p: { c: 0.9, b: -10, a: -3, lT: 55, lA: 0.2 } },
  ];

  const byId = (id) => PRESETS.find((p) => p.id === id) || PRESETS[0];

  const ZERO_TWEAK = { light: 0, sat: 0, warm: 0 };

  /** tweak: { light: -25..25 (L), sat: -60..60 (%), warm: -25..25 (b축) } */
  function apply(base, presetId, tweak = ZERO_TWEAK) {
    const p = byId(presetId).p;
    let [L, a, b] = base.lab;

    if (p.con) L = 50 + (L - 50) * p.con;
    if (p.lT != null) L += (p.lT - L) * (p.lA || 0);

    const cm = (p.c == null ? 1 : p.c) * (1 + tweak.sat / 100);
    a *= cm; b *= cm;

    a += (p.a || 0) + tweak.warm * 0.25;
    b += (p.b || 0) + tweak.warm;
    L += tweak.light;

    const out = labToRgbSafe(L, a, b);
    return { ...describe(out.r, out.g, out.b), share: base.share, base };
  }

  const isIdentity = (presetId, tweak) =>
    presetId === 'none' && !tweak.light && !tweak.sat && !tweak.warm;

  return { PRESETS, byId, apply, isIdentity, ZERO_TWEAK };
})();
