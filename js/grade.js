'use strict';

/* 색 보정. 뽑힌 컬러칩에 프리셋과 미세조정을 Lab 공간에서 적용한다.
   화풍·필름·물감 프리셋은 각각의 색 경향에서 영감을 얻은 해석이지 복원이 아니다. */

CC.grade = (() => {
  const { labToRgbSafe, describe } = CC.color;

  const GROUPS = [
    { id: 'tone',  label: '톤' },
    { id: 'art',   label: '화풍' },
    { id: 'film',  label: '필름' },
    { id: 'paint', label: '물감' },
  ];

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
    { id: 'warm',   group: 'tone', label: '따뜻한', hint: '노을빛처럼 붉고 노란 기운을 더합니다.', p: { a: 5, b: 12, c: 1.05 } },
    { id: 'cool',   group: 'tone', label: '차가운', hint: '푸른 기운을 더해 서늘하게.', p: { a: -3, b: -12, c: 1.0 } },
    { id: 'mono',   group: 'tone', label: '모노',   hint: '색을 거의 빼고 명암만 남깁니다.', p: { c: 0.08 } },

    // ---- 화풍
    { id: 'vangogh',   group: 'art', label: '반 고흐',  hint: '노랑과 파랑의 강한 대비, 두터운 색.', p: { c: 1.3, b: 8, con: 1.15 } },
    { id: 'monet',     group: 'art', label: '모네',     hint: '빛을 머금은 옅고 서늘한 인상파 색.', p: { lT: 76, lA: 0.45, c: 0.78, b: -5 } },
    { id: 'renoir',    group: 'art', label: '르누아르', hint: '장밋빛이 감도는 따뜻하고 부드러운 색.', p: { lT: 68, lA: 0.3, c: 0.9, a: 5, b: 6 } },
    { id: 'picasso',   group: 'art', label: '피카소',   hint: '청색 시대 · 푸르고 가라앉은 색.', p: { c: 0.75, a: -4, b: -14, lT: 48, lA: 0.2 } },
    { id: 'klimt',     group: 'art', label: '클림트',   hint: '금빛 · 따뜻한 황금색이 감돕니다.', p: { c: 1.1, a: 5, b: 18, lT: 58, lA: 0.2 } },
    { id: 'munch',     group: 'art', label: '뭉크',     hint: '불안하게 타오르는 붉고 짙은 색.', p: { c: 1.25, a: 6, b: 6, con: 1.2, lT: 45, lA: 0.15 } },
    { id: 'warhol',    group: 'art', label: '워홀',     hint: '팝아트 · 평면적이고 아주 선명한 원색.', p: { c: 1.7, lT: 60, lA: 0.2, con: 1.1 } },
    { id: 'rembrandt', group: 'art', label: '렘브란트', hint: '어둠 속 황금빛 · 짙은 명암 대비.', p: { lT: 32, lA: 0.45, c: 0.85, a: 4, b: 12, con: 1.2 } },
    { id: 'whanki',    group: 'art', label: '김환기',   hint: '점점이 번지는 깊고 푸른 색.', p: { a: -6, b: -18, c: 1.1, lT: 45, lA: 0.2 } },
    { id: 'sookeun',   group: 'art', label: '박수근',   hint: '화강암 질감 · 흙빛의 담담한 회갈색.', p: { c: 0.4, a: 3, b: 8, lT: 62, lA: 0.35, con: 0.9 } },
    { id: 'jungseob',  group: 'art', label: '이중섭',   hint: '황토빛 · 굵고 힘 있는 따뜻한 색.', p: { a: 6, b: 14, c: 1.1, con: 1.1, lT: 52, lA: 0.15 } },
    { id: 'kyungja',   group: 'art', label: '천경자',   hint: '꿈결 같은 강렬한 분홍과 푸른색.', p: { c: 1.5, a: 6, b: -4, con: 1.05 } },

    // ---- 필름
    { id: 'portra',    group: 'film', label: '포트라 400',   hint: '코닥 · 부드럽고 따뜻한 피부톤, 낮은 대비.', p: { lT: 62, lA: 0.15, c: 0.85, a: 3, b: 6 } },
    { id: 'gold',      group: 'film', label: '골드 200',     hint: '코닥 · 노랗고 따뜻한 일상 필름.', p: { b: 12, a: 3, c: 1.05, lT: 60, lA: 0.1 } },
    { id: 'ektar',     group: 'film', label: '엑타 100',     hint: '코닥 · 채도 높고 빨강이 강한 풍경용.', p: { c: 1.3, a: 5, b: 3, con: 1.08 } },
    { id: 'pro400h',   group: 'film', label: '프로 400H',    hint: '후지 · 청록빛이 감도는 파스텔 톤.', p: { lT: 68, lA: 0.2, c: 0.8, a: -5, b: -3 } },
    { id: 'velvia',    group: 'film', label: '벨비아 50',    hint: '후지 · 아주 진하고 강렬한 슬라이드 필름.', p: { c: 1.45, con: 1.15, lT: 45, lA: 0.1 } },
    { id: 'cinestill', group: 'film', label: '시네스틸 800T', hint: '텅스텐 · 푸른 밤과 붉은 빛 번짐.', p: { b: -10, a: 2, c: 1.05, con: 1.1 } },
    { id: 'polaroid',  group: 'film', label: '폴라로이드',   hint: '바랜 듯 낮은 대비, 들뜬 어두운 부분.', p: { lT: 58, lA: 0.35, c: 0.7, b: 5, con: 0.85 } },
    { id: 'hp5',       group: 'film', label: 'HP5 흑백',     hint: '일포드 · 거친 입자의 흑백.', p: { c: 0.05, con: 1.15 } },

    // ---- 물감
    { id: 'watercolor', group: 'paint', label: '수채',     hint: '물에 풀린 듯 맑고 옅게.', p: { lT: 78, lA: 0.5, c: 0.7 } },
    { id: 'gouache',    group: 'paint', label: '과슈',     hint: '불투명하고 매트한 중간 톤.', p: { lT: 58, lA: 0.3, c: 0.85, con: 0.9 } },
    { id: 'oil',        group: 'paint', label: '유화',     hint: '깊고 진하며 따뜻한 광택.', p: { c: 1.15, lT: 45, lA: 0.2, a: 3, b: 4, con: 1.1 } },
    { id: 'acrylic',    group: 'paint', label: '아크릴',   hint: '밝고 쨍한 플라스틱 질감의 색.', p: { c: 1.35, con: 1.05 } },
    { id: 'oilpastel',  group: 'paint', label: '오일 파스텔', hint: '왁스처럼 진하고 따뜻하게.', p: { c: 1.2, b: 6, lT: 55, lA: 0.15 } },
    { id: 'pencil',     group: 'paint', label: '색연필',   hint: '가볍고 부드러운 필압.', p: { lT: 66, lA: 0.3, c: 0.85 } },
    { id: 'tempera',    group: 'paint', label: '템페라',   hint: '매트하고 차분한, 살짝 따뜻한 색.', p: { c: 0.8, lT: 62, lA: 0.3, b: 5, con: 0.95 } },
    { id: 'inkwash',    group: 'paint', label: '수묵',     hint: '먹의 농담만 남긴 서늘한 회색.', p: { c: 0.12, lT: 40, lA: 0.25, b: -3 } },
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

  return { GROUPS, PRESETS, byId, apply, isIdentity, ZERO_TWEAK };
})();
