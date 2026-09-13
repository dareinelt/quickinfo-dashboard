/**
 * quickinfo Board – Retina-taugliche Zeitreihen-Charts auf HTML5 Canvas.
 * Keine externen Abhängigkeiten.
 *
 *   const chart = new TimeChart(containerEl, { unit: '%', min: 0, max: 100 });
 *   chart.setData({ from, to, step, series: [{ key, label, color, points: [[ts, value], …] }] });
 */
(function (global) {
  'use strict';

  const PAD = { top: 12, right: 14, bottom: 26, left: 44 };

  const PALETTE = ['#4f8cff', '#37d39a', '#f5b840', '#ff5c6c', '#8b5cf6', '#45c4f0', '#ff8a4c', '#e879f9',
    '#a3e635', '#fb7185', '#2dd4bf', '#facc15', '#60a5fa', '#c084fc', '#f472b6', '#34d399'];

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function fmtTime(ts) { const d = new Date(ts * 1000); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
  function fmtDate(ts) { const d = new Date(ts * 1000); return pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + '.'; }
  function fmtDateTime(ts) { const d = new Date(ts * 1000); return pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + '. ' + fmtTime(ts); }
  function hexToRgba(hex, a) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!m) return hex;
    return 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' + parseInt(m[3], 16) + ',' + a + ')';
  }

  function niceTicks(min, max, count) {
    const span = max - min || 1;
    const rough = span / Math.max(1, count);
    const mag = Math.pow(10, Math.floor(Math.log10(rough)));
    const norm = rough / mag;
    let step = 10;
    if (norm <= 1) step = 1; else if (norm <= 2) step = 2; else if (norm <= 2.5) step = 2.5; else if (norm <= 5) step = 5;
    step *= mag;
    const ticks = [];
    const start = Math.ceil(min / step) * step;
    for (let v = start; v <= max + step * 1e-6; v += step) ticks.push(+v.toFixed(6));
    return { ticks, step };
  }

  function timeTicks(from, to, width) {
    const span = to - from;
    const target = Math.max(3, Math.floor(width / 90));
    const candidates = [60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400, 172800, 259200];
    let step = candidates[candidates.length - 1];
    for (const c of candidates) { if (span / c <= target) { step = c; break; } }
    const ticks = [];
    // Bei Tagesrastern auf lokale Mitternacht ausrichten
    const offset = step >= 86400 ? new Date(from * 1000).getTimezoneOffset() * 60 : 0;
    let t = Math.ceil((from - offset) / step) * step + offset;
    for (; t <= to; t += step) ticks.push(t);
    return { ticks, step };
  }

  class TimeChart {
    constructor(container, opts) {
      this.container = container;
      this.opts = Object.assign({ unit: '', min: null, max: null, fill: true, decimals: 1, fixedMax: null, thresholds: [] }, opts || {});
      this.canvas = document.createElement('canvas');
      this.tip = document.createElement('div');
      this.tip.className = 'chart-tip';
      this.emptyEl = document.createElement('div');
      this.emptyEl.className = 'chart-empty hidden';
      this.emptyEl.textContent = 'Noch keine Daten für diesen Zeitraum';
      container.appendChild(this.canvas);
      container.appendChild(this.tip);
      container.appendChild(this.emptyEl);
      this.ctx = this.canvas.getContext('2d');
      this.data = null;
      this.hoverX = null;
      this.legendEl = this.opts.legendEl || null;

      this._onMove = (e) => { const r = this.canvas.getBoundingClientRect(); this.hoverX = e.clientX - r.left; this.draw(); };
      this._onLeave = () => { this.hoverX = null; this.tip.style.opacity = '0'; this.draw(); };
      this.canvas.addEventListener('mousemove', this._onMove);
      this.canvas.addEventListener('mouseleave', this._onLeave);
      this.canvas.addEventListener('touchstart', (e) => { if (e.touches[0]) this._onMove(e.touches[0]); }, { passive: true });
      this.canvas.addEventListener('touchmove', (e) => { if (e.touches[0]) this._onMove(e.touches[0]); }, { passive: true });
      this.canvas.addEventListener('touchend', this._onLeave);

      this.ro = new ResizeObserver(() => this.draw());
      this.ro.observe(container);
    }

    destroy() {
      this.ro.disconnect();
      this.canvas.remove(); this.tip.remove(); this.emptyEl.remove();
    }

    setData(data) {
      this.data = data;
      (data.series || []).forEach((s, i) => { if (!s.color) s.color = PALETTE[i % PALETTE.length]; });
      this.renderLegend();
      this.draw();
    }

    renderLegend() {
      if (!this.legendEl || !this.data) return;
      this.legendEl.innerHTML = '';
      for (const s of this.data.series) {
        const span = document.createElement('span');
        const i = document.createElement('i'); i.style.background = s.color;
        span.appendChild(i); span.appendChild(document.createTextNode(s.label));
        this.legendEl.appendChild(span);
      }
    }

    _resize() {
      const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
      const w = this.container.clientWidth, h = this.container.clientHeight;
      if (w === 0 || h === 0) return false;
      const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
      if (this.canvas.width !== pw || this.canvas.height !== ph) {
        this.canvas.width = pw; this.canvas.height = ph;
      }
      this.w = w; this.h = h; this.dpr = dpr;
      return true;
    }

    draw() {
      if (!this._resize()) return;
      const ctx = this.ctx, w = this.w, h = this.h;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const d = this.data;
      const hasData = d && d.series && d.series.some(s => s.points && s.points.length);
      this.emptyEl.classList.toggle('hidden', !!hasData);
      if (!d) return;

      const x0 = PAD.left, x1 = w - PAD.right, y0 = PAD.top, y1 = h - PAD.bottom;
      const pw = x1 - x0, ph = y1 - y0;
      const from = d.from, to = d.to;

      // Y-Bereich bestimmen
      let min = this.opts.min, max = this.opts.max;
      if (min === null || max === null) {
        let lo = Infinity, hi = -Infinity;
        for (const s of d.series) for (const p of s.points) { if (p[1] === null) continue; if (p[1] < lo) lo = p[1]; if (p[1] > hi) hi = p[1]; }
        if (!isFinite(lo)) { lo = 0; hi = 1; }
        if (min === null) min = Math.min(0, lo);
        if (max === null) {
          max = hi <= min ? min + 1 : hi;
          const { step } = niceTicks(min, max, 4);
          max = Math.ceil((max + step * 0.05) / step) * step;
        }
        if (this.opts.fixedMax !== null) max = Math.max(max, this.opts.fixedMax);
      }
      const yOf = v => y1 - ((v - min) / (max - min)) * ph;
      const xOf = t => x0 + ((t - from) / (to - from)) * pw;

      ctx.font = '11px ' + getComputedStyle(document.body).fontFamily;
      ctx.textBaseline = 'middle';

      // Raster + Y-Achse
      const yt = niceTicks(min, max, Math.max(2, Math.floor(ph / 45)));
      ctx.lineWidth = 1;
      for (const v of yt.ticks) {
        const y = Math.round(yOf(v)) + 0.5;
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
        ctx.fillStyle = '#647089'; ctx.textAlign = 'right';
        ctx.fillText(this._fmtVal(v, 0) + this.opts.unit, x0 - 8, y);
      }

      // Schwellenwerte
      for (const th of this.opts.thresholds) {
        if (th.value < min || th.value > max) continue;
        const y = Math.round(yOf(th.value)) + 0.5;
        ctx.strokeStyle = hexToRgba(th.color, 0.5); ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); ctx.setLineDash([]);
      }

      // X-Achse
      const xt = timeTicks(from, to, pw);
      ctx.fillStyle = '#647089'; ctx.textAlign = 'center';
      let lastDay = null;
      for (const t of xt.ticks) {
        const x = Math.round(xOf(t)) + 0.5;
        ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
        let label;
        if (xt.step >= 86400) label = fmtDate(t);
        else {
          const day = new Date(t * 1000).getDate();
          label = fmtTime(t);
          if ((to - from) > 86400 && day !== lastDay && lastDay !== null) label = fmtDate(t) + ' ' + label;
          lastDay = day;
        }
        ctx.fillText(label, x, y1 + 14);
      }

      // Clip auf Plotbereich
      ctx.save();
      ctx.beginPath(); ctx.rect(x0, y0 - 1, pw, ph + 2); ctx.clip();

      const gap = (d.step || 60) * 2.5;
      for (const s of d.series) {
        if (!s.points.length) continue;
        const segments = [];
        let cur = [];
        let prevT = null;
        for (const p of s.points) {
          if (p[1] === null || (prevT !== null && p[0] - prevT > gap)) { if (cur.length) segments.push(cur); cur = []; }
          if (p[1] !== null) cur.push(p);
          prevT = p[0];
        }
        if (cur.length) segments.push(cur);

        for (const seg of segments) {
          if (this.opts.fill && d.series.length <= 2) {
            const grad = ctx.createLinearGradient(0, y0, 0, y1);
            grad.addColorStop(0, hexToRgba(s.color, d.series.length === 1 ? 0.28 : 0.14));
            grad.addColorStop(1, hexToRgba(s.color, 0));
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.moveTo(xOf(seg[0][0]), y1);
            for (const p of seg) ctx.lineTo(xOf(p[0]), yOf(p[1]));
            ctx.lineTo(xOf(seg[seg.length - 1][0]), y1);
            ctx.closePath(); ctx.fill();
          }
          ctx.strokeStyle = s.color; ctx.lineWidth = s.width || (d.series.length > 4 ? 1.25 : 1.8);
          ctx.lineJoin = 'round'; ctx.lineCap = 'round';
          ctx.beginPath();
          seg.forEach((p, i) => { const x = xOf(p[0]), y = yOf(p[1]); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
          ctx.stroke();
          if (seg.length === 1) {
            ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(xOf(seg[0][0]), yOf(seg[0][1]), 2.5, 0, Math.PI * 2); ctx.fill();
          }
        }
      }
      ctx.restore();

      // Hover
      if (this.hoverX !== null && hasData && this.hoverX >= x0 && this.hoverX <= x1) {
        const t = from + ((this.hoverX - x0) / pw) * (to - from);
        const rows = [];
        let snapT = null;
        for (const s of d.series) {
          const p = this._nearest(s.points, t, gap);
          if (!p) continue;
          if (snapT === null || Math.abs(p[0] - t) < Math.abs(snapT - t)) snapT = p[0];
          rows.push({ s, p });
        }
        if (snapT !== null) {
          const x = Math.round(xOf(snapT)) + 0.5;
          ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.setLineDash([3, 3]);
          ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke(); ctx.setLineDash([]);
          for (const r of rows) {
            if (r.p[0] !== snapT) continue;
            ctx.fillStyle = r.s.color; ctx.beginPath(); ctx.arc(xOf(r.p[0]), yOf(r.p[1]), 3.5, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = '#0b0e14'; ctx.lineWidth = 1.5; ctx.stroke();
          }
          const html = ['<div class="t">' + fmtDateTime(snapT) + '</div>'];
          const sorted = rows.filter(r => r.p[0] === snapT).sort((a, b) => b.p[1] - a.p[1]).slice(0, 12);
          for (const r of sorted) {
            html.push('<div class="r"><i style="background:' + r.s.color + '"></i>' + this._esc(r.s.label) + '<b>' + this._fmtVal(r.p[1], this.opts.decimals) + this.opts.unit + '</b></div>');
          }
          if (rows.length > 12) html.push('<div class="r muted">… ' + (rows.length - 12) + ' weitere</div>');
          this.tip.innerHTML = html.join('');
          this.tip.style.opacity = '1';
          const tipW = this.tip.offsetWidth;
          let left = x; if (left - tipW / 2 < 4) left = tipW / 2 + 4; if (left + tipW / 2 > w - 4) left = w - tipW / 2 - 4;
          this.tip.style.left = left + 'px';
          this.tip.style.top = (y0 + 4) + 'px';
        } else {
          this.tip.style.opacity = '0';
        }
      } else {
        this.tip.style.opacity = '0';
      }
    }

    _nearest(points, t, maxDist) {
      if (!points.length) return null;
      let lo = 0, hi = points.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (points[mid][0] < t) lo = mid + 1; else hi = mid; }
      let best = points[lo];
      if (lo > 0 && Math.abs(points[lo - 1][0] - t) < Math.abs(best[0] - t)) best = points[lo - 1];
      if (best[1] === null || Math.abs(best[0] - t) > maxDist) return null;
      return best;
    }

    _fmtVal(v, dec) {
      if (v === null || v === undefined || !isFinite(v)) return '–';
      if (Math.abs(v) >= 1000) return Math.round(v).toLocaleString('de-DE');
      return (+v).toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: dec });
    }

    _esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  }

  global.TimeChart = TimeChart;
  global.CHART_PALETTE = PALETTE;
})(window);
