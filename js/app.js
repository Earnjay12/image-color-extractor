'use strict';

/* 화면 연결. 상태를 바꾸는 입력은 전부 recompute() 로 모인다.
   무거운 군집화는 이미지를 올릴 때 한 번, 그 뒤는 선택·보정만 하므로 즉시 반응한다. */

(() => {
  const { readableOn } = CC.color;
  const { sample, cluster, select, MOODS } = CC.extract;
  const { GROUPS, PRESETS, byId, apply, isIdentity, ZERO_TWEAK } = CC.grade;

  const $ = (id) => document.getElementById(id);
  const el = {
    intro: $('intro'), dropzone: $('dropzone'), fileInput: $('fileInput'),
    workspace: $('workspace'), previewImg: $('previewImg'), fileMeta: $('fileMeta'),
    replaceBtn: $('replaceBtn'), stepper: $('stepper'),
    moodSeg: $('moodSeg'), moodHint: $('moodHint'),
    countRange: $('countRange'), countOut: $('countOut'),
    presetTabs: $('presetTabs'), presetPills: $('presetPills'), gradeHint: $('gradeHint'),
    twL: $('twL'), twC: $('twC'), twW: $('twW'),
    twLOut: $('twLOut'), twCOut: $('twCOut'), twWOut: $('twWOut'),
    tweakReset: $('tweakReset'),
    resultSummary: $('resultSummary'), status: $('status'), palette: $('palette'),
    downloadBtn: $('downloadBtn'), toast: $('toast'),
  };

  const state = {
    image: null, objectUrl: null, fileName: '',
    clusters: [],
    moodId: 'balanced', count: 5,
    presetId: 'none', presetGroup: 'tone', tweak: { ...ZERO_TWEAK },
    colors: [],
  };

  /* ---------- 선택 UI ---------- */

  function buildPills(container, items, onPick) {
    container.innerHTML = '';
    for (const it of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pill';
      b.dataset.id = it.id;
      b.textContent = it.label;
      b.setAttribute('role', 'radio');
      b.addEventListener('click', () => onPick(it.id));
      container.appendChild(b);
    }
  }

  function syncPills(container, current) {
    for (const b of container.querySelectorAll('.pill')) {
      b.setAttribute('aria-checked', String(b.dataset.id === current));
    }
  }

  function buildTabs() {
    el.presetTabs.innerHTML = '';
    for (const g of GROUPS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tab';
      b.dataset.id = g.id;
      b.textContent = g.label;
      b.setAttribute('role', 'tab');
      b.addEventListener('click', () => { state.presetGroup = g.id; renderPresets(); });
      el.presetTabs.appendChild(b);
    }
  }

  function renderPresets() {
    const activeGroup = byId(state.presetId).group;
    for (const t of el.presetTabs.querySelectorAll('.tab')) {
      t.setAttribute('aria-selected', String(t.dataset.id === state.presetGroup));
      t.classList.toggle('has-active', t.dataset.id === activeGroup && activeGroup !== state.presetGroup && state.presetId !== 'none');
    }
    buildPills(el.presetPills, PRESETS.filter((p) => p.group === state.presetGroup), pickPreset);
    syncPills(el.presetPills, state.presetId);
  }

  function pickPreset(id) {
    state.presetId = id;
    state.presetGroup = byId(id).group;
    recompute();
  }

  buildPills(el.moodSeg, MOODS, (id) => { state.moodId = id; recompute(); });
  buildTabs();
  renderPresets();
  syncPills(el.moodSeg, state.moodId);

  /* ---------- 계산 ---------- */

  function recompute() {
    if (!state.clusters.length) return;
    const base = select(state.clusters, state.moodId, state.count);
    state.colors = base.map((c) => apply(c, state.presetId, state.tweak));
    render();
  }

  /* ---------- 렌더 ---------- */

  function render() {
    const mood = MOODS.find((m) => m.id === state.moodId);
    const preset = byId(state.presetId);
    const tweaked = !!(state.tweak.light || state.tweak.sat || state.tweak.warm);
    const graded = !isIdentity(state.presetId, state.tweak);

    syncPills(el.moodSeg, state.moodId);
    renderPresets();
    el.moodHint.textContent = mood.hint;
    el.gradeHint.textContent = preset.hint;
    el.countOut.textContent = state.count;
    el.twLOut.textContent = fmtSigned(state.tweak.light);
    el.twCOut.textContent = fmtSigned(state.tweak.sat);
    el.twWOut.textContent = fmtSigned(state.tweak.warm);
    el.tweakReset.hidden = !tweaked;

    let summary = mood.label + ' · ' + (preset.id === 'none' ? '원본' : preset.label);
    if (tweaked) summary += ' + 미세조정';
    el.resultSummary.textContent = summary;

    el.palette.innerHTML = '';
    for (const c of state.colors) el.palette.appendChild(chipCard(c, graded));

    const n = state.colors.length;
    el.downloadBtn.disabled = n === 0;
    if (n === 0) setStatus('분석할 수 있는 픽셀이 없습니다. 다른 이미지를 올려 보세요.');
    else if (n < state.count) setStatus('이미지에 뚜렷이 구분되는 색이 ' + n + '개뿐이라 그만큼만 추출했습니다.');
    else setStatus('');
  }

  function chipCard(c, graded) {
    const li = document.createElement('li');
    li.className = 'chip';

    const sw = document.createElement('div');
    sw.className = 'chip-swatch';
    sw.style.background = c.hex;

    if (graded && c.base.hex !== c.hex) {
      const dot = document.createElement('span');
      dot.className = 'chip-base';
      dot.style.background = c.base.hex;
      dot.title = '보정 전 ' + c.base.hex;
      sw.appendChild(dot);
    }

    const share = document.createElement('span');
    share.className = 'chip-share';
    share.style.color = readableOn(c.r, c.g, c.b);
    share.textContent = (c.share * 100).toFixed(1) + '%';
    sw.appendChild(share);

    const codes = document.createElement('div');
    codes.className = 'chip-codes';
    codes.append(
      codeRow('HEX', c.hex, c.hex, true),
      codeRow('RGB', c.r + ' ' + c.g + ' ' + c.b, 'rgb(' + c.r + ', ' + c.g + ', ' + c.b + ')'),
      codeRow('CMYK', c.cmyk.join(' '), c.cmyk.join(', ')),
    );

    li.append(sw, codes);
    return li;
  }

  function codeRow(label, shown, copyValue, primary) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'code' + (primary ? ' primary' : '');
    b.title = label + ' 복사';
    const l = document.createElement('span'); l.className = 'code-label'; l.textContent = label;
    const v = document.createElement('span'); v.className = 'code-value'; v.textContent = shown;
    b.append(l, v);
    b.addEventListener('click', () => copy(copyValue, label + ' 복사됨 · ' + copyValue));
    return b;
  }

  const fmtSigned = (v) => (v > 0 ? '+' + v : String(v));

  function setStatus(text) {
    el.status.textContent = text;
    el.status.hidden = !text;
  }

  let toastTimer = null;
  function showToast(message) {
    el.toast.textContent = message;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 1800);
  }

  async function copy(text, message) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e) { /* 무시 */ }
      ta.remove();
    }
    showToast(message);
  }

  function setStep(n) {
    for (const li of el.stepper.querySelectorAll('li')) {
      const s = Number(li.dataset.step);
      li.classList.toggle('done', s < n);
      li.classList.toggle('active', s >= n);
    }
  }

  /* ---------- 이미지 로드 ---------- */

  function loadFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) { showToast('이미지 파일만 올릴 수 있습니다.'); return; }

    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
      state.objectUrl = url;
      state.image = img;
      state.fileName = file.name || 'image';

      el.previewImg.src = url;
      el.fileMeta.textContent = state.fileName + '  ·  ' + img.naturalWidth + ' × ' + img.naturalHeight + 'px';
      el.intro.hidden = true;
      el.workspace.hidden = false;
      setStep(2);
      el.palette.innerHTML = '';
      el.downloadBtn.disabled = true;
      setStatus('색상을 분석하는 중…');

      // 군집화는 동기 작업이라 한 틱 양보해 "분석 중" 문구를 먼저 그린다
      setTimeout(() => {
        state.clusters = cluster(sample(img));
        recompute();
      }, 16);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      showToast('이미지를 읽지 못했습니다. 파일이 손상되지 않았는지 확인해 주세요.');
    };
    img.src = url;
  }

  /* ---------- 내보내기 ---------- */

  function download() {
    if (!state.image || !state.colors.length) return;
    const graded = !isIdentity(state.presetId, state.tweak);
    const preset = byId(state.presetId);
    const cv = CC.sheet.build({
      image: state.image,
      fileName: state.fileName,
      colors: state.colors,
      moodLabel: MOODS.find((m) => m.id === state.moodId).label,
      gradeLabel: !graded ? '원본' : (preset.id === 'none' ? '미세조정' : preset.label),
      graded,
    });
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

  /* ---------- 이벤트 ---------- */

  el.dropzone.addEventListener('click', () => el.fileInput.click());
  el.dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.fileInput.click(); }
  });
  el.replaceBtn.addEventListener('click', () => el.fileInput.click());
  el.fileInput.addEventListener('change', () => {
    loadFile(el.fileInput.files[0]);
    el.fileInput.value = '';
  });

  ['dragenter', 'dragover'].forEach((ev) =>
    el.dropzone.addEventListener(ev, (e) => { e.preventDefault(); el.dropzone.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach((ev) =>
    el.dropzone.addEventListener(ev, (e) => { e.preventDefault(); el.dropzone.classList.remove('dragover'); }));
  el.dropzone.addEventListener('drop', (e) => loadFile(e.dataTransfer.files[0]));

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

  el.countRange.addEventListener('input', () => { state.count = Number(el.countRange.value); recompute(); });

  const bindTweak = (input, key) =>
    input.addEventListener('input', () => { state.tweak[key] = Number(input.value); recompute(); });
  bindTweak(el.twL, 'light');
  bindTweak(el.twC, 'sat');
  bindTweak(el.twW, 'warm');

  el.tweakReset.addEventListener('click', () => {
    state.tweak = { ...ZERO_TWEAK };
    el.twL.value = 0; el.twC.value = 0; el.twW.value = 0;
    recompute();
  });

  el.downloadBtn.addEventListener('click', download);

  // 테스트·디버깅용 노출
  window.ColorChip = { state, loadFile, recompute, renderPresets };
})();
