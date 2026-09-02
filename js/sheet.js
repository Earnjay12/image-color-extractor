'use strict';

/* PNG 내보내기 — 원본 이미지와 컬러칩을 한 장의 시트로 그린다. */

CC.sheet = (() => {
  const { readableOn } = CC.color;

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

  /**
   * @param {object} o
   * @param {HTMLImageElement} o.image
   * @param {string} o.fileName
   * @param {Array} o.colors      보정 후 색 (각각 .base 에 보정 전 색)
   * @param {string} o.moodLabel
   * @param {string} o.gradeLabel
   * @param {boolean} o.graded    보정이 적용됐는지
   */
  function build({ image, fileName, colors, moodLabel, gradeLabel, graded }) {
    const W = 1280, PAD = 64, GAP = 18;
    const IMG_MAX_H = 640, SWATCH_H = 132, CHIP_H = SWATCH_H + 108;
    const SANS = '"Pretendard Variable", Pretendard, "Segoe UI", system-ui, "Malgun Gothic", sans-serif';
    const MONO = '"JetBrains Mono", Consolas, ui-monospace, Menlo, monospace';

    const contentW = W - PAD * 2;
    const scale = Math.min(contentW / image.naturalWidth, IMG_MAX_H / image.naturalHeight, 1);
    const drawW = Math.round(image.naturalWidth * scale);
    const drawH = Math.round(image.naturalHeight * scale);

    let cols = Math.min(6, colors.length);
    const rows = Math.ceil(colors.length / cols);
    cols = Math.ceil(colors.length / rows);
    const chipW = (contentW - GAP * (cols - 1)) / cols;

    const headerH = 92;
    const gridH = rows * CHIP_H + (rows - 1) * GAP;
    const H = PAD + headerH + drawH + 52 + gridH + 36 + 28 + PAD;

    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, W, H);
    ctx.textBaseline = 'alphabetic';

    // ---- 헤더
    let y = PAD;
    ctx.fillStyle = '#141412';
    ctx.font = '700 30px ' + SANS;
    ctx.fillText(fileName, PAD, y + 28);

    ctx.fillStyle = '#8A8884';
    ctx.font = '500 15px ' + SANS;
    const stamp = new Date().toLocaleDateString('ko-KR');
    const parts = [
      '컬러칩 ' + colors.length + '개',
      '추출 · ' + moodLabel,
      '보정 · ' + gradeLabel,
      image.naturalWidth + ' × ' + image.naturalHeight + 'px',
      stamp,
    ];
    ctx.fillText(parts.join('   ·   '), PAD, y + 58);

    ctx.fillStyle = '#E8E6E1';
    ctx.fillRect(PAD, y + 78, contentW, 1);
    y += headerH;

    // ---- 이미지
    const imgX = PAD + Math.round((contentW - drawW) / 2);
    ctx.save();
    roundRect(ctx, imgX, y, drawW, drawH, 10);
    ctx.clip();
    ctx.drawImage(image, imgX, y, drawW, drawH);
    ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,.08)';
    ctx.lineWidth = 1;
    roundRect(ctx, imgX + 0.5, y + 0.5, drawW - 1, drawH - 1, 10);
    ctx.stroke();
    y += drawH + 52;

    // ---- 컬러칩
    colors.forEach((c, i) => {
      const x = PAD + (i % cols) * (chipW + GAP);
      const cy = y + Math.floor(i / cols) * (CHIP_H + GAP);

      ctx.fillStyle = c.hex;
      roundRect(ctx, x, cy, chipW, SWATCH_H, 10);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.08)';
      roundRect(ctx, x + 0.5, cy + 0.5, chipW - 1, SWATCH_H - 1, 10);
      ctx.stroke();

      // 보정 전 원본 색을 작은 원으로 표시
      if (graded && c.base && c.base.hex !== c.hex) {
        ctx.fillStyle = c.base.hex;
        ctx.beginPath();
        ctx.arc(x + 20, cy + 20, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.85)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.lineWidth = 1;
      }

      ctx.fillStyle = readableOn(c.r, c.g, c.b);
      ctx.font = '600 12px ' + MONO;
      ctx.fillText((c.share * 100).toFixed(1) + '%', x + 14, cy + SWATCH_H - 13);

      let ty = cy + SWATCH_H + 30;
      ctx.fillStyle = '#141412';
      ctx.font = '700 20px ' + MONO;
      ctx.fillText(c.hex, x, ty);

      ctx.fillStyle = '#5C5A55';
      ctx.font = '500 13.5px ' + MONO;
      ty += 25;
      ctx.fillText('RGB   ' + c.r + '  ' + c.g + '  ' + c.b, x, ty);
      ty += 21;
      ctx.fillText('CMYK  ' + c.cmyk.join('  '), x, ty);
    });
    y += gridH + 36;

    // ---- 푸터
    ctx.fillStyle = '#A8A6A1';
    ctx.font = '500 12.5px ' + SANS;
    let foot = 'CMYK 값은 ICC 프로파일 없이 계산한 근사값입니다.';
    if (graded) foot += '   ·   칩 왼쪽 위 작은 원은 보정 전 원본 색입니다.';
    ctx.fillText(foot, PAD, y + 14);
    ctx.textAlign = 'right';
    ctx.fillText('Color Chip', W - PAD, y + 14);
    ctx.textAlign = 'left';

    return cv;
  }

  return { build };
})();
