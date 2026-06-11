// ── STATE ──────────────────────────────────────────────────────────────
let completions = [];
let activeTab   = 'level';
let editingId   = null;
let fullListMode = false;
let scrollHintDismissed = false;
let tlTab         = 'level';
let tlMonths      = 6;
let tlSelectedCol = null;
let pendingImage = null;   // base64 of the final cropped thumbnail
let rawImage     = null;   // Image object for the crop tool

// crop drag state
let isDragging = false;
let dragStart  = { x: 0, y: 0 };
let cropBox    = { x: 0, y: 0, w: 0, h: 0 };

const CROP_ASPECT = 16 / 9;
const THUMB_W = 480;
const THUMB_H = 270;

// ── BOOT ───────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  tryLoadFromServer();
});

async function tryLoadFromServer() {
  try {
    const res = await fetch('default.json');
    if (res.ok) {
      const data = await res.json();
      completions = Array.isArray(data.completions) ? data.completions : [];
    }
  } catch (_) { /* file not found or fetch not supported — start empty */ }
  renderList();
}

// ── EVENT BINDING ──────────────────────────────────────────────────────
function bindEvents() {
  // Tab switches
  document.querySelectorAll('.lvl-tab').forEach(btn =>
    btn.addEventListener('click', () => {
      document.querySelectorAll('.lvl-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeTab = btn.dataset.tab;
      renderList();
    })
  );

  // Toolbar buttons
  document.getElementById('openAddModal').addEventListener('click', () => openModal(null));
  document.getElementById('loadFileBtn').addEventListener('click', () =>
    document.getElementById('jsonFileInput').click()
  );
  document.getElementById('jsonFileInput').addEventListener('change', handleLoadFile);
  document.getElementById('exportBtn').addEventListener('click', exportJSON);
  document.querySelector('.view-all-btn').addEventListener('click', () => {
    fullListMode = !fullListMode;
    renderList();
  });

  // Modal open/close
  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('cancelBtn').addEventListener('click', closeModal);
  document.getElementById('modalOverlay').addEventListener('click', e => {
    if (e.target.id === 'modalOverlay') closeModal();
  });
  document.getElementById('saveBtn').addEventListener('click', saveCompletion);

  // Image upload triggers
  document.getElementById('uploadPrompt').addEventListener('click', () =>
    document.getElementById('imgFileInput').click()
  );
  document.getElementById('rechoooseBtn').addEventListener('click', () =>
    document.getElementById('imgFileInput').click()
  );
  document.getElementById('imgFileInput').addEventListener('change', handleImageUpload);
  document.getElementById('applyCropBtn').addEventListener('click', applyCrop);

  // Type toggle in modal
  document.querySelectorAll('.type-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    })
  );

  // Rate status toggle in modal
  document.querySelectorAll('.rate-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      document.querySelectorAll('.rate-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    })
  );

  // Timeline tabs
  document.querySelectorAll('.tl-tab').forEach(btn =>
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tl-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      tlTab = btn.dataset.tltab;
      tlSelectedCol = null;
      renderTimeline();
    })
  );

  // Timeline filter buttons
  document.querySelectorAll('.tl-filter-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tl-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      tlMonths = parseInt(btn.dataset.months);
      tlSelectedCol = null;
      renderTimeline();
    })
  );

  // Crop canvas mouse events
  const canvas = document.getElementById('cropCanvas');
  canvas.addEventListener('mousedown', onCropDown);
  canvas.addEventListener('mousemove', onCropMove);
  canvas.addEventListener('mouseup',   () => { isDragging = false; });
  canvas.addEventListener('mouseleave',() => { isDragging = false; });

  // Touch support for crop canvas
  canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    onCropDown(e.touches[0]);
  }, { passive: false });
  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    onCropMove(e.touches[0]);
  }, { passive: false });
  canvas.addEventListener('touchend', () => { isDragging = false; });
}

// ── OVERVIEW STAT HELPERS ──────────────────────────────────────────────
function parsePlaytime(str) {
  if (!str || str === '—') return 0;
  let mins = 0;
  const h = str.match(/(\d+(?:\.\d+)?)\s*h/i);
  const m = str.match(/(\d+(?:\.\d+)?)\s*m/i);
  if (h) mins += parseFloat(h[1]) * 60;
  if (m) mins += parseFloat(m[1]);
  return Math.round(mins);
}

function formatDuration(mins) {
  if (!mins) return '—';
  return (mins / 60).toFixed(1) + ' hr';
}

function fmtN(n) {
  if (!n) return '—';
  if (n >= 10000) return Math.round(n / 1000) + ' k';
  if (n >= 1000)  return (n / 1000).toFixed(1).replace(/\.0$/, '') + ' k';
  return n.toLocaleString();
}

function updateOverviewStats() {
  const items = completions.filter(c => c.type === activeTab);

  // Enjoyment
  const enjItems = items.filter(c => c.enjoyment != null && !isNaN(c.enjoyment));
  const avgEnj   = enjItems.length
    ? Math.round(enjItems.reduce((s, c) => s + c.enjoyment, 0) / enjItems.length)
    : null;
  const valEl    = document.getElementById('avgEnjoymentVal');
  const ringFill = document.getElementById('enjoymentRingFill');
  if (valEl)    valEl.textContent = avgEnj != null ? avgEnj : '—';
  if (ringFill) {
    const offset = avgEnj != null ? 238.76 * (1 - avgEnj / 100) : 238.76;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      ringFill.style.strokeDashoffset = offset;
    }));
  }

  // Attempts
  const attItems = items.filter(c => c.attempts);
  const totalAtt = attItems.reduce((s, c) => s + (c.attempts || 0), 0);
  const avgAtt   = attItems.length ? Math.round(totalAtt / attItems.length) : null;
  const totalAttEl = document.getElementById('totalAttemptsVal');
  const avgAttEl   = document.getElementById('avgAttemptsVal');
  if (totalAttEl) totalAttEl.textContent = totalAtt ? fmtN(totalAtt) : '—';
  if (avgAttEl)   avgAttEl.textContent   = avgAtt   ? fmtN(avgAtt)   : '—';

  // Playtime
  const ptItems   = items.filter(c => c.playtime);
  const totalMins = ptItems.reduce((s, c) => s + parsePlaytime(c.playtime), 0);
  const avgMins   = ptItems.length ? Math.round(totalMins / ptItems.length) : 0;
  const totalPtEl = document.getElementById('totalPlaytimeVal');
  const avgPtEl   = document.getElementById('avgPlaytimeVal');
  if (totalPtEl) totalPtEl.textContent = formatDuration(totalMins);
  if (avgPtEl)   avgPtEl.textContent   = formatDuration(avgMins);
}

// ── STAT CARDS ─────────────────────────────────────────────────────────
function updateStatCards() {
  updateCard('favLevel',     completions.find(c => c.isFavoriteLevel));
  updateCard('favChallenge', completions.find(c => c.isFavoriteChallenge));
  updateCard('recent',       completions.find(c => c.isMostRecent));
}

function updateCard(slot, c) {
  const card = document.querySelector(`.stat-card[data-slot="${slot}"]`);
  if (!card) return;
  const thumb = card.querySelector('.card-thumb');
  const title = card.querySelector('.card-title');
  const sub   = card.querySelector('.card-sub');
  if (c) {
    thumb.style.cssText = c.image
      ? `background-image:url('${c.image}');background-size:cover;background-position:center`
      : '';
    title.textContent = c.name || 'Unknown';
    sub.innerHTML = `by ${esc(c.creator || '—')} <span class="card-rating">&#9733; ${c.enjoyment != null ? c.enjoyment + '%' : '—'}</span>`;
  } else {
    thumb.style.cssText = '';
    title.textContent = '—';
    sub.innerHTML = 'not set yet';
  }
}

// ── TIMELINE ──────────────────────────────────────────────────────────
function getMonthSnapshots(type, monthCount) {
  const items = completions.filter(c => c.type === type && c.completionDate);
  const now   = new Date();
  const months = [];

  for (let i = monthCount - 1; i >= 0; i--) {
    const d       = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const cutoff  = i === 0 ? now : lastDay;
    const label   = d.toLocaleString('default', { month: 'short' }) + " '" + String(d.getFullYear()).slice(2);
    months.push({ year: d.getFullYear(), month: d.getMonth(), label, isCurrent: i === 0, cutoff });
  }

  const snapshots = months.map(({ cutoff }) => {
    const beaten = items.filter(c => new Date(c.completionDate) <= cutoff);
    beaten.sort((a, b) => a.position - b.position);
    return beaten.slice(0, 5);
  });

  // Trim leading all-empty months, always keep at least the current month
  let start = 0;
  while (start < snapshots.length - 1 && snapshots[start].length === 0) start++;

  return { months: months.slice(start), snapshots: snapshots.slice(start) };
}

function renderTimeline() {
  const body = document.getElementById('timelineBody');
  if (!body) return;

  const { months, snapshots } = getMonthSnapshots(tlTab, tlMonths);
  const N = months.length;

  if (N === 0 || snapshots.every(s => s.length === 0)) {
    body.innerHTML = `<div class="empty-state">No ${tlTab === 'level' ? 'extreme levels' : 'challenges'} with completion dates.<br>Add a completion date to start your timeline.</div>`;
    const panel = document.getElementById('tlSelectedPanel');
    if (panel) panel.style.display = 'none';
    return;
  }

  if (tlSelectedCol === null || tlSelectedCol >= N) tlSelectedCol = N - 1;

  const colTemplate = `2.6rem repeat(${N}, minmax(56px, 1fr))`;
  let html = `<div class="timeline-scroll-wrap"><svg class="timeline-svg" id="tlSvg"></svg><div class="timeline-grid" id="tlGrid" style="grid-template-columns:${colTemplate}">`;

  // Header row
  html += `<div class="tl-corner"></div>`;
  months.forEach((m, ci) => {
    const cls = ['tl-month-header', m.isCurrent ? 'tl-current' : '', tlSelectedCol === ci ? 'tl-selected' : ''].filter(Boolean).join(' ');
    const dot = m.isCurrent ? `<span class="tl-now-dot"></span>` : '';
    html += `<div class="${cls}" data-col="${ci}">${m.label}${dot}</div>`;
  });

  // Rank rows
  for (let rank = 0; rank < 5; rank++) {
    html += `<div class="tl-rank-label">#${rank + 1}</div>`;
    months.forEach((m, ci) => {
      const level = snapshots[ci][rank];
      const cls   = ['tl-cell', m.isCurrent ? 'tl-current' : '', tlSelectedCol === ci ? 'tl-selected' : ''].filter(Boolean).join(' ');
      const thumb = level
        ? `<div class="tl-thumb" style="${level.image ? `background-image:url('${level.image}');background-size:cover;background-position:center` : placeholderGrad(rank + 1)}" title="${esc(level.name)}"></div>`
        : `<div class="tl-thumb tl-thumb-empty"></div>`;
      html += `<div class="${cls}" data-col="${ci}" data-rank="${rank}">${thumb}</div>`;
    });
  }

  html += `</div></div>`;
  body.innerHTML = html;

  updateTlPanel(months[tlSelectedCol], snapshots[tlSelectedCol]);

  // Column click — update selection + panel without full re-render
  body.querySelectorAll('.tl-month-header[data-col]').forEach(el => {
    el.addEventListener('click', () => {
      const ci = parseInt(el.dataset.col);
      tlSelectedCol = ci;
      body.querySelectorAll('.tl-month-header').forEach(h =>
        h.classList.toggle('tl-selected', parseInt(h.dataset.col) === ci)
      );
      body.querySelectorAll('.tl-cell').forEach(c =>
        c.classList.toggle('tl-selected', parseInt(c.dataset.col) === ci)
      );
      updateTlPanel(months[ci], snapshots[ci]);
    });
  });

  requestAnimationFrame(() => drawTimelineLines(snapshots));
}

function drawTimelineLines(snapshots) {
  const svg  = document.getElementById('tlSvg');
  const grid = document.getElementById('tlGrid');
  if (!svg || !grid) return;

  const gridRect = grid.getBoundingClientRect();
  const wrapRect = svg.parentElement.getBoundingClientRect();

  svg.style.left   = (gridRect.left - wrapRect.left) + 'px';
  svg.style.top    = (gridRect.top  - wrapRect.top)  + 'px';
  svg.style.width  = gridRect.width  + 'px';
  svg.style.height = gridRect.height + 'px';
  svg.innerHTML    = '';

  function thumbCenter(cellEl) {
    const thumb = cellEl.querySelector('.tl-thumb:not(.tl-thumb-empty)');
    if (!thumb) return null;
    const r = thumb.getBoundingClientRect();
    return { x: r.left + r.width / 2 - gridRect.left, y: r.top + r.height / 2 - gridRect.top };
  }

  const N = snapshots.length;
  const connections = [];

  for (let ci = 0; ci < N - 1; ci++) {
    const currMap = new Map(snapshots[ci].map((c, i) => [c.id, i]));
    const nextMap = new Map(snapshots[ci + 1].map((c, i) => [c.id, i]));

    for (const [id, r0] of currMap) {
      if (!nextMap.has(id)) continue;
      const r1    = nextMap.get(id);
      const fromEl = grid.querySelector(`[data-col="${ci}"][data-rank="${r0}"]`);
      const toEl   = grid.querySelector(`[data-col="${ci + 1}"][data-rank="${r1}"]`);
      if (!fromEl || !toEl) continue;
      const from = thumbCenter(fromEl);
      const to   = thumbCenter(toEl);
      if (!from || !to) continue;
      connections.push({ x1: from.x, y1: from.y, x2: to.x, y2: to.y });
    }
  }

  // Dark overlays over every filled thumbnail — drawn first (bottom SVG layer)
  for (let ci = 0; ci < N; ci++) {
    snapshots[ci].forEach((level, rank) => {
      if (!level) return;
      const cellEl = grid.querySelector(`[data-col="${ci}"][data-rank="${rank}"]`);
      if (!cellEl) return;
      const thumb = cellEl.querySelector('.tl-thumb:not(.tl-thumb-empty)');
      if (!thumb) return;
      const r = thumb.getBoundingClientRect();
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x',      r.left - gridRect.left);
      rect.setAttribute('y',      r.top  - gridRect.top);
      rect.setAttribute('width',  r.width);
      rect.setAttribute('height', r.height);
      rect.setAttribute('rx', '8');
      rect.setAttribute('fill', 'rgba(0,0,0,0.10)');
      svg.appendChild(rect);
    });
  }

  const mkPath = (d, stroke, width) => {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d);
    p.setAttribute('stroke', stroke);
    p.setAttribute('stroke-width', width);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke-linecap', 'round');
    return p;
  };

  connections.forEach(({ x1, y1, x2, y2 }) => {
    const pull = (x2 - x1) * 0.45;
    const d = `M ${x1} ${y1} C ${x1 + pull} ${y1}, ${x2 - pull} ${y2}, ${x2} ${y2}`;
    svg.appendChild(mkPath(d, 'white', '7'));
  });
  connections.forEach(({ x1, y1, x2, y2 }) => {
    const pull = (x2 - x1) * 0.45;
    const d = `M ${x1} ${y1} C ${x1 + pull} ${y1}, ${x2 - pull} ${y2}, ${x2} ${y2}`;
    svg.appendChild(mkPath(d, '#1a1714', '2.5'));
  });

  // Dots on every filled thumbnail, drawn on top of lines
  for (let ci = 0; ci < N; ci++) {
    snapshots[ci].forEach((level, rank) => {
      if (!level) return;
      const cellEl = grid.querySelector(`[data-col="${ci}"][data-rank="${rank}"]`);
      if (!cellEl) return;
      const pos = thumbCenter(cellEl);
      if (!pos) return;
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('cx', pos.x);
      dot.setAttribute('cy', pos.y);
      dot.setAttribute('r', '5');
      dot.setAttribute('fill', '#f97316');
      dot.setAttribute('stroke', 'white');
      dot.setAttribute('stroke-width', '2.5');
      svg.appendChild(dot);
    });
  }
}

function updateTlPanel(month, snapshot) {
  const panel    = document.getElementById('tlSelectedPanel');
  const monthEl  = document.getElementById('tlSelMonth');
  const levelsEl = document.getElementById('tlSelLevels');
  if (!panel || !monthEl || !levelsEl) return;

  if (!month || !snapshot || snapshot.length === 0) {
    panel.style.display = 'none';
    return;
  }

  panel.style.display = 'flex';
  monthEl.textContent  = month.label;

  // Pad to 5 slots
  const items = snapshot.slice();
  while (items.length < 5) items.push(null);

  levelsEl.innerHTML = items.map((c, i) => {
    if (!c) return `<div class="tl-sel-item"><div class="tl-sel-rank">#${i + 1}</div><div class="tl-sel-thumb tl-thumb-empty"></div><div class="tl-sel-name" style="color:#c8c2bc">—</div></div>`;
    const bg = c.image
      ? `background-image:url('${c.image}');background-size:cover;background-position:center`
      : placeholderGrad(i + 1);
    return `<div class="tl-sel-item"><div class="tl-sel-rank">#${i + 1}</div><div class="tl-sel-thumb" style="${bg}"></div><div class="tl-sel-name">${esc(c.name)}</div></div>`;
  }).join('');
}

// ── RENDER LIST ────────────────────────────────────────────────────────
function renderList() {
  const list = document.getElementById('levelsList');
  const sorted = completions
    .filter(c => c.type === activeTab)
    .sort((a, b) => a.position - b.position);
  const items = fullListMode ? sorted : sorted.slice(0, 5);

  // sync button text and list mode class
  const viewBtn = document.querySelector('.view-all-text');
  if (viewBtn) viewBtn.textContent = fullListMode ? 'Collapse' : 'View Full List';
  list.classList.toggle('is-full-list', fullListMode);

  const existingHint = document.getElementById('scrollHint');
  if (existingHint) existingHint.remove();
  if (fullListMode && !scrollHintDismissed) {
    const hint = document.createElement('div');
    hint.id = 'scrollHint';
    hint.innerHTML = `<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
    const card = document.querySelector('.levels-card');
    card.appendChild(hint);
    requestAnimationFrame(() => {
      const cardRect = card.getBoundingClientRect();
      const btnRect  = document.querySelector('.view-all-btn').getBoundingClientRect();
      hint.style.left = (btnRect.left + btnRect.width  / 2 - cardRect.left) + 'px';
      hint.style.top  = (btnRect.top  + btnRect.height / 2 - cardRect.top - 70 - 22) + 'px';
    });
    list.addEventListener('scroll', function() {
      scrollHintDismissed = true;
      hint.remove();
    }, { once: true });
  }

  updateStatCards();
  updateOverviewStats();
  renderTimeline();

  if (!items.length) {
    const label = activeTab === 'level' ? 'extreme levels' : 'challenges';
    list.innerHTML = `<div class="empty-state">No ${label} added yet.<br>Click <strong>+</strong> to log your first completion.</div>`;
    return;
  }

  list.innerHTML = items.map((c, i) => buildEntryHTML(c, i + 1, fullListMode && i > 0)).join('');

  list.querySelectorAll('.edit-btn').forEach(btn =>
    btn.addEventListener('click', () => openModal(btn.dataset.id))
  );
  list.querySelectorAll('.delete-btn').forEach(btn =>
    btn.addEventListener('click', () => deleteEntry(btn.dataset.id))
  );
  list.querySelectorAll('.play-btn').forEach(btn =>
    btn.addEventListener('click', () => window.open(btn.dataset.link, '_blank'))
  );
}

function buildEntryHTML(c, rank, compressed = false) {
  const thumbStyle = c.image
    ? `background-image:url('${c.image}');background-size:cover;background-position:center`
    : placeholderGrad(rank);

  const rated    = c.rateStatus !== 'unrated';
  const rateCls  = rated ? 'rated' : 'unrated';
  const rateText = rated ? '&#9733; Rated' : '&#9733; Unrated';

  const enjoyment = c.enjoyment != null ? `${c.enjoyment}%` : '—';
  const attempts  = c.attempts  ? Number(c.attempts).toLocaleString() : '—';
  const playtime  = c.playtime  || '—';

  const playBtn = c.link
    ? `<button class="play-btn" data-link="${esc(c.link)}" title="Watch on YouTube">
        <svg width="16" height="18" viewBox="0 0 12 14" fill="#e02d1e"><path d="M1 1.5l10 5.5-10 5.5z"/></svg>
      </button>`
    : '';

  return `
    <div class="level-entry${compressed ? ' compressed' : ''}">
      <span class="level-rank">${rank}</span>
      <div class="level-thumb-wrap"><div class="level-thumb" style="${thumbStyle}"></div></div>
      <div class="level-info">
        <div class="level-name">${esc(c.name)}</div>
        <div class="level-creator">
          by ${esc(c.creator)}
        </div>
        <span class="rate-badge ${rateCls}">${rateText}</span>
      </div>
      <div class="level-stats">
        <div class="stat-col">
          <span class="stat-val">${enjoyment}</span>
          <span class="stat-lbl">Enjoyment</span>
        </div>
        <div class="stat-col">
          <span class="stat-val">${attempts}</span>
          <span class="stat-lbl">Attempts</span>
        </div>
        <div class="stat-col">
          <span class="stat-val">${playtime}</span>
          <span class="stat-lbl">Playtime</span>
        </div>
      </div>
      ${playBtn}
      <div class="entry-actions">
        <button class="entry-btn edit-btn"   data-id="${c.id}" title="Edit">&#9998;</button>
        <button class="entry-btn delete-btn" data-id="${c.id}" title="Remove">&#10005;</button>
      </div>
    </div>`;
}

function diffColor(diff) {
  const map = {
    'Easy Demon':    '#16a34a',
    'Medium Demon':  '#ca8a04',
    'Hard Demon':    '#ea580c',
    'Insane Demon':  '#7c3aed',
    'Extreme Demon': '#dc2626',
  };
  return map[diff] || '#dc2626';
}

function placeholderGrad(rank) {
  const grads = [
    'linear-gradient(135deg,#3a1f6e,#8b2fc9)',
    'linear-gradient(135deg,#6b1a00,#c94500)',
    'linear-gradient(135deg,#0d3b6e,#1a72c9)',
    'linear-gradient(135deg,#006b3a,#00c97a)',
    'linear-gradient(135deg,#3a3a00,#c9b400)',
  ];
  return `background:${grads[(rank - 1) % grads.length]}`;
}

function esc(str) {
  return String(str || '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// ── MODAL ──────────────────────────────────────────────────────────────
function openModal(id) {
  editingId    = id;
  pendingImage = null;
  rawImage     = null;

  resetImageUI();

  // Reset type toggle to Level
  document.querySelectorAll('.type-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.type === 'level')
  );

  if (id) {
    const c = completions.find(x => x.id === id);
    if (c) {
      document.getElementById('fName').value      = c.name           || '';
      document.getElementById('fCreator').value   = c.creator        || '';
      document.getElementById('fPosition').value  = c.position       || '';
      document.getElementById('fEnjoyment').value = c.enjoyment != null ? c.enjoyment : '';
      document.getElementById('fPlaytime').value  = c.playtime       || '';
      document.getElementById('fAttempts').value  = c.attempts       || '';
      document.getElementById('fDate').value           = c.completionDate  || '';
      document.getElementById('fLink').value           = c.link            || '';
      document.getElementById('fAredlPlacement').value = c.aredlPlacement != null ? c.aredlPlacement : '';
      document.getElementById('fWorstFail').value      = c.worstFail      != null ? c.worstFail      : '';
      document.querySelectorAll('.type-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.type === c.type)
      );
      document.querySelectorAll('.rate-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.rate === (c.rateStatus || 'rated'))
      );
      document.getElementById('chkFavLevel').checked     = !!c.isFavoriteLevel;
      document.getElementById('chkFavChallenge').checked = !!c.isFavoriteChallenge;
      document.getElementById('chkRecent').checked       = !!c.isMostRecent;
      if (c.image) {
        pendingImage = c.image;
        showPreview(c.image);
      }
    }
    document.getElementById('modalTitle').textContent = 'Edit Completion';
  } else {
    clearForm();
    document.getElementById('modalTitle').textContent = 'Add Completion';
  }

  document.getElementById('modalOverlay').classList.add('active');
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('active');
  editingId    = null;
  pendingImage = null;
  rawImage     = null;
}

function clearForm() {
  ['fName','fCreator','fPosition','fEnjoyment','fPlaytime','fAttempts','fDate','fLink','fAredlPlacement','fWorstFail'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.querySelectorAll('.rate-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.rate === 'rated')
  );
  document.getElementById('chkFavLevel').checked     = false;
  document.getElementById('chkFavChallenge').checked = false;
  document.getElementById('chkRecent').checked       = true;
}

function resetImageUI() {
  document.getElementById('uploadPrompt').style.display  = 'flex';
  document.getElementById('cropArea').style.display      = 'none';
  document.getElementById('cropPreview').style.display   = 'none';
  document.getElementById('imgFileInput').value = '';
}

function showPreview(src) {
  document.getElementById('uploadPrompt').style.display = 'none';
  document.getElementById('cropArea').style.display     = 'none';
  document.getElementById('previewImg').src             = src;
  document.getElementById('cropPreview').style.display  = 'flex';
}

// ── IMAGE UPLOAD & CROP ────────────────────────────────────────────────
function handleImageUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';

  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      rawImage = img;
      initCropTool();
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

function initCropTool() {
  const canvas = document.getElementById('cropCanvas');

  document.getElementById('uploadPrompt').style.display = 'none';
  document.getElementById('cropPreview').style.display  = 'none';
  document.getElementById('cropArea').style.display     = 'flex';

  // Size canvas to fit the modal panel (~260px wide)
  const maxW = 258;
  const imgAspect = rawImage.naturalWidth / rawImage.naturalHeight;
  canvas.width  = maxW;
  canvas.height = Math.round(maxW / imgAspect);

  // Initial crop box: 16:9, centred
  if (imgAspect > CROP_ASPECT) {
    cropBox.h = canvas.height * 0.94;
    cropBox.w = cropBox.h * CROP_ASPECT;
  } else {
    cropBox.w = canvas.width * 0.94;
    cropBox.h = cropBox.w / CROP_ASPECT;
  }
  cropBox.x = (canvas.width  - cropBox.w) / 2;
  cropBox.y = (canvas.height - cropBox.h) / 2;

  drawCrop();
}

function drawCrop() {
  const canvas = document.getElementById('cropCanvas');
  const ctx    = canvas.getContext('2d');
  const { x, y, w, h } = cropBox;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Dimmed full image
  ctx.save();
  ctx.globalAlpha = 0.32;
  ctx.drawImage(rawImage, 0, 0, canvas.width, canvas.height);
  ctx.restore();

  // Bright cropped region
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.globalAlpha = 1;
  ctx.drawImage(rawImage, 0, 0, canvas.width, canvas.height);
  ctx.restore();

  // White border
  ctx.strokeStyle = 'rgba(255,255,255,0.88)';
  ctx.lineWidth   = 1.5;
  ctx.strokeRect(x, y, w, h);

  // Corner handles
  const hs = 6;
  ctx.fillStyle = '#ffffff';
  [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].forEach(([hx, hy]) => {
    ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
  });
}

function onCropDown(e) {
  const canvas = document.getElementById('cropCanvas');
  const rect   = canvas.getBoundingClientRect();
  const scaleX = canvas.width  / rect.width;
  const scaleY = canvas.height / rect.height;
  const mx = (e.clientX - rect.left) * scaleX;
  const my = (e.clientY - rect.top)  * scaleY;
  const { x, y, w, h } = cropBox;
  if (mx >= x && mx <= x + w && my >= y && my <= y + h) {
    isDragging = true;
    dragStart  = { x: mx - x, y: my - y };
  }
}

function onCropMove(e) {
  if (!isDragging) return;
  const canvas = document.getElementById('cropCanvas');
  const rect   = canvas.getBoundingClientRect();
  const scaleX = canvas.width  / rect.width;
  const scaleY = canvas.height / rect.height;
  const mx = (e.clientX - rect.left) * scaleX;
  const my = (e.clientY - rect.top)  * scaleY;
  cropBox.x = Math.max(0, Math.min(canvas.width  - cropBox.w, mx - dragStart.x));
  cropBox.y = Math.max(0, Math.min(canvas.height - cropBox.h, my - dragStart.y));
  drawCrop();
}

function applyCrop() {
  const canvas = document.getElementById('cropCanvas');
  const { x, y, w, h } = cropBox;
  const sx = rawImage.naturalWidth  / canvas.width;
  const sy = rawImage.naturalHeight / canvas.height;

  const out = document.createElement('canvas');
  out.width  = THUMB_W;
  out.height = THUMB_H;
  out.getContext('2d').drawImage(
    rawImage,
    x * sx, y * sy, w * sx, h * sy,
    0, 0, THUMB_W, THUMB_H
  );

  pendingImage = out.toDataURL('image/jpeg', 0.82);
  rawImage = null;
  showPreview(pendingImage);
}

// ── SAVE / DELETE ──────────────────────────────────────────────────────
function saveCompletion() {
  const name     = document.getElementById('fName').value.trim();
  const creator  = document.getElementById('fCreator').value.trim();
  const position = parseInt(document.getElementById('fPosition').value, 10);
  const enjoyment= parseInt(document.getElementById('fEnjoyment').value, 10);
  const playtime = document.getElementById('fPlaytime').value.trim();
  const attempts = parseInt(document.getElementById('fAttempts').value, 10) || 0;
  const completionDate    = document.getElementById('fDate').value;
  const link              = document.getElementById('fLink').value.trim();
  const aredlPlacement    = parseInt(document.getElementById('fAredlPlacement').value, 10) || null;
  const worstFail         = parseInt(document.getElementById('fWorstFail').value, 10);
  const rateStatus        = document.querySelector('.rate-btn.active')?.dataset.rate || 'rated';
  const type              = document.querySelector('.type-btn.active')?.dataset.type || 'level';
  const isFavoriteLevel   = document.getElementById('chkFavLevel').checked;
  const isFavoriteChallenge = document.getElementById('chkFavChallenge').checked;
  const isMostRecent      = document.getElementById('chkRecent').checked;

  if (!name || !creator || !position || isNaN(enjoyment)) {
    alert('Please fill in: Level Name, Creator, Position #, and Enjoyment %.');
    return;
  }

  // Strip exclusive flags from any completion that currently holds them
  if (isFavoriteLevel)     completions.forEach(c => { if (c.id !== editingId) c.isFavoriteLevel     = false; });
  if (isFavoriteChallenge) completions.forEach(c => { if (c.id !== editingId) c.isFavoriteChallenge = false; });
  if (isMostRecent)        completions.forEach(c => { if (c.id !== editingId) c.isMostRecent        = false; });

  if (editingId) {
    const idx = completions.findIndex(c => c.id === editingId);
    if (idx > -1) {
      const existing = completions[idx];
      completions[idx] = {
        ...existing,
        name, creator, position, enjoyment, playtime, attempts,
        completionDate, rateStatus, link, type,
        aredlPlacement, worstFail: isNaN(worstFail) ? null : worstFail,
        isFavoriteLevel, isFavoriteChallenge, isMostRecent,
        image: pendingImage !== null ? pendingImage : existing.image,
      };
    }
  } else {
    // Shift down any entries at or beyond the target position (same type)
    completions
      .filter(c => c.type === type && c.position >= position)
      .forEach(c => c.position++);

    completions.push({
      id: String(Date.now()),
      name, creator, position, enjoyment, playtime, attempts,
      completionDate, rateStatus, link, type,
      aredlPlacement, worstFail: isNaN(worstFail) ? null : worstFail,
      isFavoriteLevel, isFavoriteChallenge, isMostRecent,
      image: pendingImage || null,
    });
  }

  closeModal();
  renderList();
}

function deleteEntry(id) {
  if (!confirm('Remove this completion?')) return;
  completions = completions.filter(c => c.id !== id);
  renderList();
}

// ── EXPORT / IMPORT ────────────────────────────────────────────────────
function exportJSON() {
  const json = JSON.stringify({ completions }, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'demons.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function handleLoadFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';

  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      completions = Array.isArray(data.completions) ? data.completions : [];
      renderList();
    } catch (_) {
      alert('Could not read file — make sure it is a valid demons.json.');
    }
  };
  reader.readAsText(file);
}
