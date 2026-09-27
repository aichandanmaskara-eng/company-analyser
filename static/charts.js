/* Company Analyser — chart engine (Apache ECharts adapter).
   Keeps the spec format used by the views: bar | line | area | waterfall | doughnut | radar | gauge | hbar | scatter. */
'use strict';
const Charts = (() => {
  const INST = new Set();
  const root = document.documentElement;
  const cssVar = n => getComputedStyle(root).getPropertyValue(n).trim();
  const resolve = c => { if (!c) return c; const m = /^var\((--[\w-]+)\)$/.exec(c); return m ? cssVar(m[1]) : c; };
  const col = k => `var(--c${(k % 8) + 1})`;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = v => typeof v === 'number' && isFinite(v);
  const still = () => root.classList.contains('no-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches;
  const compactF = v => (typeof compact === 'function' ? compact(v) : String(v));

  function theme() {
    return { text: cssVar('--text'), muted: cssVar('--muted'), grid: cssVar('--gridc'), card: cssVar('--card'),
      tipBg: cssVar('--tip-bg'), tipText: cssVar('--tip-text'), font: cssVar('--font') || 'Inter, sans-serif',
      pos: cssVar('--pos'), neg: cssVar('--neg'), warn: cssVar('--warn'), accent: cssVar('--accent'),
      palette: [1, 2, 3, 4, 5, 6, 7, 8].map(i => cssVar('--c' + i)) };
  }
  function base(anim) {
    const t = theme();
    return { t, opt: {
      animation: anim && !still(), animationDuration: 750, animationEasing: 'cubicOut',
      color: t.palette, textStyle: { fontFamily: t.font, color: t.muted },
      tooltip: { confine: true, backgroundColor: t.tipBg, borderWidth: 0, padding: [8, 11],
        textStyle: { color: t.tipText, fontSize: 12, fontFamily: t.font },
        extraCssText: 'border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.25);' } } };
  }
  const axisLabel = (t, f) => ({ color: t.muted, fontSize: 11, formatter: f ? (v => f(v)) : undefined, hideOverlap: true });

  function cartesian(sp, anim) {
    const { t, opt } = base(anim);
    const n = sp.labels.length, baseKind = sp.type === 'bar' ? 'bar' : sp.type === 'area' ? 'area' : 'line';
    const kind = s => s.kind || baseKind;
    const fmt = sp.fmt || compactF, fmt2 = sp.fmt2 || fmt, tf = sp.tf || fmt, tf2 = sp.tf2 || fmt2;
    const hasY2 = sp.series.some(s => s.axis === 'y2'), anyBar = sp.series.some(s => kind(s) === 'bar');
    const yAxis = (f, grid) => ({ type: 'value', scale: sp.zero === false && !anyBar, axisLabel: axisLabel(t, f),
      splitLine: { show: grid, lineStyle: { color: t.grid } }, axisLine: { show: false } });
    const zoom = n > 30;
    Object.assign(opt, {
      grid: { left: 6, right: hasY2 ? 6 : 14, top: sp.series.length > 1 ? 36 : 14, bottom: zoom ? 34 : 6, containLabel: true },
      legend: { show: sp.series.length > 1, top: 0, type: 'scroll', icon: 'roundRect', itemWidth: 12, itemHeight: 10,
        textStyle: { color: t.text, fontSize: 12 }, pageTextStyle: { color: t.muted } },
      xAxis: { type: 'category', data: sp.labels, axisLabel: axisLabel(t), axisTick: { show: false },
        axisLine: { lineStyle: { color: t.grid } } },
      yAxis: hasY2 ? [yAxis(fmt, true), yAxis(fmt2, false)] : [yAxis(fmt, true)],
      dataZoom: zoom ? [{ type: 'inside' }, { type: 'slider', height: 16, bottom: 4, borderColor: 'transparent',
        textStyle: { color: t.muted }, brushSelect: false }] : undefined,
    });
    opt.tooltip = { ...opt.tooltip, trigger: 'axis', axisPointer: { type: anyBar ? 'shadow' : 'line', shadowStyle: { opacity: .06 } },
      formatter: ps => {
        ps = Array.isArray(ps) ? ps : [ps];
        let h = `<b>${esc(ps[0].axisValueLabel)}</b>`;
        ps.forEach(p => { if (!num(p.value)) return; const s = sp.series[p.seriesIndex];
          h += `<br>${p.marker}${esc(s.name)}: <b>${esc((s.axis === 'y2' ? tf2 : tf)(p.value))}</b>`; });
        return h; } };
    opt.series = sp.series.map((s, k) => {
      const c = resolve(s.color) || t.palette[k % 8], K = kind(s);
      const o = { name: s.name, type: K === 'bar' ? 'bar' : 'line', yAxisIndex: s.axis === 'y2' ? 1 : 0,
        data: s.data.map(v => num(v) ? v : null), itemStyle: { color: c }, emphasis: { focus: 'series' } };
      if (K === 'bar') { o.barMaxWidth = 44; o.itemStyle.borderRadius = sp.stacked ? 0 : [4, 4, 0, 0]; if (sp.stacked) o.stack = 's'; }
      else { o.smooth = .25; o.symbol = 'circle'; o.symbolSize = n > 24 ? 4 : 7; o.showSymbol = n <= 40;
        o.lineStyle = { width: 2.5, color: c }; o.connectNulls = false; if (K === 'area') o.areaStyle = { opacity: .15 }; }
      return o;
    });
    const f0 = opt.series[0];
    if (num(sp.highlight) && sp.highlight >= 0 && sp.highlight < n && n <= 30)
      f0.markArea = { silent: true, itemStyle: { color: t.accent, opacity: .08 },
        data: [[{ xAxis: sp.highlight - .5 >= 0 ? sp.labels[sp.highlight] : sp.labels[0] }, { xAxis: sp.labels[sp.highlight] }]] };
    if (sp.refs && sp.refs.length)
      f0.markLine = { silent: true, symbol: 'none', lineStyle: { type: 'dashed', color: t.warn },
        label: { formatter: '{b}', color: t.warn, position: 'insideEndTop', fontSize: 11 },
        data: sp.refs.map(r => ({ yAxis: r.v, name: r.label })) };
    return opt;
  }

  function waterfall(sp, anim) {
    const { t, opt } = base(anim);
    let run = 0;
    const rows = sp.steps.map((s, i) => { let a, b; if (s.total) { a = 0; b = s.value; run = s.value; } else { a = run; b = run + s.value; run = b; }
      return [i, a, b, s.value, s.total ? 1 : 0]; });
    const cTot = t.palette[0];
    Object.assign(opt, {
      grid: { left: 6, right: 14, top: 24, bottom: 6, containLabel: true },
      xAxis: { type: 'category', data: sp.steps.map(s => s.label), axisTick: { show: false }, axisLine: { lineStyle: { color: t.grid } },
        axisLabel: { color: t.muted, fontSize: 11, interval: 0, rotate: sp.steps.length > 5 ? 32 : 0 } },
      yAxis: { type: 'value', axisLabel: axisLabel(t, sp.fmt), splitLine: { lineStyle: { color: t.grid } } },
    });
    opt.tooltip = { ...opt.tooltip, trigger: 'item', formatter: p => `<b>${esc(sp.steps[p.dataIndex].label)}</b><br>${esc(sp.tf(p.value[3]))}` };
    opt.series = [{ type: 'custom', data: rows, encode: { x: 0, y: [1, 2] }, renderItem: (params, api) => {
      const i = api.value(0), a = api.value(1), b = api.value(2), v = api.value(3), tot = api.value(4);
      const p0 = api.coord([i, Math.max(a, b)]), p1 = api.coord([i, Math.min(a, b)]), w = api.size([1, 0])[0] * .6;
      const fill = tot ? cTot : v >= 0 ? t.pos : t.neg;
      return { type: 'group', children: [
        { type: 'rect', shape: { x: p0[0] - w / 2, y: p0[1], width: w, height: Math.max(p1[1] - p0[1], 1), r: 3 }, style: { fill } },
        { type: 'text', silent: true, style: { text: w > 34 ? sp.fmt(v) : '', x: p0[0], y: p0[1] - 4, align: 'center', verticalAlign: 'bottom',
          fill: t.text, font: `600 11px ${t.font}` } }] };
    } }];
    return opt;
  }

  function doughnut(sp, anim) {
    const { t, opt } = base(anim);
    const it = sp.items.filter(d => num(d.value) && d.value > 0);
    opt.tooltip = { ...opt.tooltip, trigger: 'item', formatter: p => `${p.marker}<b>${esc(p.name)}</b><br>${esc(sp.tf(p.value))} · ${p.percent}%` };
    opt.series = [{ type: 'pie', radius: ['58%', '86%'], avoidLabelOverlap: true, label: { show: false },
      itemStyle: { borderColor: t.card, borderWidth: 2, borderRadius: 5 }, emphasis: { scale: true, scaleSize: 6 },
      data: it.map((d, k) => ({ name: d.label, value: d.value, itemStyle: { color: resolve(d.color) || t.palette[k % 8] } })) }];
    if (sp.center) opt.graphic = [
      { type: 'text', left: 'center', top: '41%', style: { text: sp.center.label, fill: t.muted, font: `12px ${t.font}` } },
      { type: 'text', left: 'center', top: '51%', style: { text: sp.center.value, fill: t.text, font: `700 15px ${t.font}` } }];
    return opt;
  }

  function radar(sp, anim) {
    const { t, opt } = base(anim);
    const shown = sp.series.filter(s => !(sp.hidden && sp.hidden.has(s.name)));
    opt.radar = { indicator: sp.labels.map(l => ({ name: l, max: 100 })), radius: '62%', center: ['50%', '52%'],
      axisName: { color: t.muted, fontSize: 11 }, splitLine: { lineStyle: { color: t.grid } }, splitArea: { show: false },
      axisLine: { lineStyle: { color: t.grid } } };
    opt.legend = { show: sp.series.length > 1, bottom: 0, type: 'scroll', textStyle: { color: t.text, fontSize: 12 } };
    opt.tooltip = { ...opt.tooltip, trigger: 'item', formatter: p => { const s = shown[p.dataIndex];
      return `<b>${esc(s.name)}</b><br>` + sp.labels.map((l, j) => `${esc(l)}: ${esc(s.raw ? s.raw[j] : Math.round(s.data[j] ?? 0))}`).join('<br>'); } };
    opt.series = [{ type: 'radar', symbolSize: 5, data: shown.map((s, k) => {
      const c = resolve(s.color) || t.palette[sp.series.indexOf(s) % 8];
      return { name: s.name, value: s.data.map(v => num(v) ? Math.max(0, Math.min(100, v)) : 0),
        itemStyle: { color: c }, lineStyle: { width: 2, color: c }, areaStyle: { opacity: .15, color: c } }; }) }];
    return opt;
  }

  function gauge(sp, anim) {
    const { t, opt } = base(anim);
    const v = Math.max(0, Math.min(100, sp.value));
    const c = v >= 75 ? t.pos : v >= 58 ? t.palette[1] : v >= 42 ? t.warn : t.neg;
    opt.series = [{ type: 'gauge', startAngle: 200, endAngle: -20, min: 0, max: 100, radius: '100%', center: ['50%', '62%'],
      progress: { show: true, width: 16, roundCap: true, itemStyle: { color: c } },
      axisLine: { roundCap: true, lineStyle: { width: 16, color: [[1, t.grid]] } },
      pointer: { show: false }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false }, anchor: { show: false },
      title: { offsetCenter: [0, '30%'], color: t.muted, fontSize: 12 },
      detail: { valueAnimation: true, offsetCenter: [0, '-4%'], fontSize: 40, fontWeight: 700, color: t.text, formatter: '{value}' },
      data: [{ value: Math.round(v), name: 'out of 100' }] }];
    return opt;
  }

  function hbar(sp, anim) {
    const { t, opt } = base(anim);
    const it = sp.items;
    Object.assign(opt, {
      grid: { left: 6, right: 70, top: 6, bottom: 6, containLabel: true },
      yAxis: { type: 'category', inverse: true, data: it.map(d => d.label), axisTick: { show: false }, axisLine: { show: false },
        axisLabel: { color: t.text, fontSize: 12, width: 130, overflow: 'truncate' } },
      xAxis: { type: 'value', axisLabel: axisLabel(t, sp.fmt), splitLine: { lineStyle: { color: t.grid } } },
    });
    opt.tooltip = { ...opt.tooltip, trigger: 'item', formatter: p => `<b>${esc(p.name)}</b><br>${esc(sp.tf(p.value))}` };
    opt.series = [{ type: 'bar', barMaxWidth: 26,
      label: { show: true, position: 'right', color: t.text, fontSize: 11, fontWeight: 600, formatter: p => num(p.value) ? sp.tf(p.value) : '' },
      data: it.map((d, k) => ({ value: num(d.value) ? d.value : null,
        itemStyle: { color: resolve(d.color) || resolve(sp.color) || t.palette[sp.multi ? k % 8 : 0], borderRadius: [0, 4, 4, 0] } })) }];
    return opt;
  }

  function scatter(sp, anim) {
    const { t, opt } = base(anim);
    const P = sp.points.filter(p => num(p.x) && num(p.y)).slice(0, 3000);
    const ax = (name, horiz) => ({ type: 'value', scale: true, name, nameLocation: 'middle', nameGap: horiz ? 26 : 44,
      nameTextStyle: { color: t.muted, fontWeight: 600 }, axisLabel: axisLabel(t, compactF), splitLine: { lineStyle: { color: t.grid } } });
    Object.assign(opt, { grid: { left: 16, right: 18, top: 16, bottom: 30, containLabel: true },
      xAxis: ax(sp.xName, true), yAxis: ax(sp.yName, false), dataZoom: [{ type: 'inside' }] });
    opt.tooltip = { ...opt.tooltip, trigger: 'item', formatter: p => p.seriesIndex ? 'Trend line'
      : `${p.value[2] ? `<b>${esc(p.value[2])}</b><br>` : ''}${esc(sp.xName)}: ${compactF(p.value[0])}<br>${esc(sp.yName)}: ${compactF(p.value[1])}` };
    opt.series = [{ type: 'scatter', symbolSize: 7, itemStyle: { color: t.palette[0], opacity: .6 }, data: P.map(p => [p.x, p.y, p.label || '']) }];
    if (P.length > 2) {
      const n = P.length, mx = P.reduce((a, p) => a + p.x, 0) / n, my = P.reduce((a, p) => a + p.y, 0) / n;
      let sxy = 0, sxx = 0; P.forEach(p => { sxy += (p.x - mx) * (p.y - my); sxx += (p.x - mx) ** 2; });
      if (sxx > 0) { const b = sxy / sxx, a = my - b * mx, xs = P.map(p => p.x), x0 = Math.min(...xs), x1 = Math.max(...xs);
        opt.series.push({ type: 'line', data: [[x0, a + b * x0], [x1, a + b * x1]], showSymbol: false, silent: true,
          lineStyle: { type: 'dashed', width: 2, color: t.palette[2] } }); }
    }
    return opt;
  }

  const BUILD = { bar: cartesian, line: cartesian, area: cartesian, waterfall, doughnut, radar, gauge, hbar, scatter };
  function hasData(sp) {
    switch (sp.type) {
      case 'doughnut': return sp.items.some(d => num(d.value) && d.value > 0);
      case 'gauge': return num(sp.value);
      case 'waterfall': return sp.steps.length > 1;
      case 'hbar': return sp.items.some(d => num(d.value));
      case 'scatter': return sp.points.filter(p => num(p.x) && num(p.y)).length >= 2;
      default: return sp.series.some(s => s.data.some(num));
    }
  }
  function donutLegend(sp) {
    const it = sp.items.filter(d => num(d.value) && d.value > 0), tot = it.reduce((a, d) => a + d.value, 0);
    return `<div class="dlegend">${it.map((d, k) => `<span class="dot" style="background:${d.color || col(k)}"></span><span>${esc(d.label)}</span><span class="v">${esc(sp.tf(d.value))}</span><span class="pc">${(d.value / tot * 100).toFixed(1)}%</span>`).join('')}</div>`;
  }
  const RO = new ResizeObserver(entries => entries.forEach(e => { const c = e.target._chart; if (c && !c.isDisposed()) c.resize(); }));
  function gc() { for (const c of INST) { if (!c.getDom().isConnected) { RO.unobserve(c.getDom()); c.dispose(); INST.delete(c); } } }

  function draw(el, sp, anim = true) {
    gc();
    if (el._box && el._box._chart && !el._box._chart.isDisposed()) { el._box._chart.dispose(); INST.delete(el._box._chart); }
    el._spec = sp;
    let H = sp.height || 280;
    if (sp.type === 'hbar' && !sp.height) H = Math.max(130, sp.items.length * 34 + 30);
    if (sp.type === 'gauge') H = sp.height || 190;
    if (sp.type === 'doughnut') H = sp.height || 230;
    if (!hasData(sp)) { el.innerHTML = `<div class="empty">📭 Not enough published data for this chart</div>`; el._box = null; return; }
    el.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'ec';
    box.style.height = H + 'px';
    el.appendChild(box);
    if (sp.type === 'doughnut') el.insertAdjacentHTML('beforeend', donutLegend(sp));
    const chart = echarts.init(box, null, { renderer: 'canvas' });
    chart.setOption(BUILD[sp.type](sp, anim));
    box._chart = chart; el._box = box; INST.add(chart); RO.observe(box);
  }
  function refresh() { gc(); for (const c of [...INST]) { const el = c.getDom().parentNode; if (el && el._spec) draw(el, el._spec, false); } }
  function png(el, name) {
    const c = el._box && el._box._chart; if (!c) return;
    const url = c.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: cssVar('--card') });
    fetch(url).then(r => r.blob()).then(b => downloadBlob(b, (name || 'chart').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') + '.png'));
  }
  return { draw, refresh, png, col };
})();
