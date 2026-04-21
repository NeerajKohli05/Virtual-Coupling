// =====================================================
// app.js — Rendering, UI, Charts
// =====================================================
const sim = new Simulation();

// Canvases
const simC = document.getElementById('simCanvas'),  sCtx = simC.getContext('2d');
const piC  = document.getElementById('piCanvas'),   pCtx = piC.getContext('2d');
const spdC = document.getElementById('spdCanvas'),  vCtx = spdC.getContext('2d');

// UI elements
const trP  = document.getElementById('trainPanel');
const cpP  = document.getElementById('couplingPanel');
const kpS  = document.getElementById('kpSlider');
const kiS  = document.getElementById('kiSlider');
const kpV  = document.getElementById('kpVal');
const kiV  = document.getElementById('kiVal');
const kpFx = document.getElementById('kpFx');
const kiFx = document.getElementById('kiFx');

// History buffers
const HIST = 500;
const piHist  = [];   // {p, i, out, e}
const spdHist = [];   // [v0, v1, v2, v3]

// ── Resize ─────────────────────────────────────────
function resize() {
    [simC, piC, spdC].forEach(c => {
        c.width  = c.parentElement.clientWidth;
        c.height = c.parentElement.clientHeight;
    });
}
window.addEventListener('resize', resize);
resize();

// ── Gain sliders ───────────────────────────────────
function updGainFx() {
    const kp = sim.Kp, ki = sim.Ki;
    if (kp === 0) {
        kpFx.textContent = '→ Kp=0 : No control — gap drifts freely!';
        kpFx.style.color = '#999';
    } else if (kp < 0.15) {
        kpFx.textContent = '→ Very slow approach, very stable';
        kpFx.style.color = '#080';
    } else if (kp < 0.5) {
        kpFx.textContent = '→ Moderate: good convergence speed';
        kpFx.style.color = '#555';
    } else if (kp < 1.0) {
        kpFx.textContent = '→ Fast, watch for overshoot ⚡';
        kpFx.style.color = '#e70';
    } else {
        kpFx.textContent = '→ HIGH → strong oscillation! ⚠️';
        kpFx.style.color = '#c00';
    }
    if (ki === 0) {
        kiFx.textContent = '→ Ki=0 : P-only — steady offset will remain';
        kiFx.style.color = '#999';
    } else if (ki < 0.03) {
        kiFx.textContent = '→ Very slow offset correction';
        kiFx.style.color = '#080';
    } else if (ki < 0.1) {
        kiFx.textContent = '→ Good: removes steady-state error';
        kiFx.style.color = '#555';
    } else if (ki < 0.25) {
        kiFx.textContent = '→ Strong integral — overshoot risk ⚡';
        kiFx.style.color = '#e70';
    } else {
        kiFx.textContent = '→ TOO HIGH → integral windup ⚠️';
        kiFx.style.color = '#c00';
    }
}

kpS.oninput = e => { sim.Kp = +e.target.value; kpV.textContent = (+e.target.value).toFixed(2); updGainFx(); };
kiS.oninput = e => { sim.Ki = +e.target.value; kiV.textContent = (+e.target.value).toFixed(2); updGainFx(); };
// Sync initial slider values to physics defaults
sim.Kp = +kpS.value; sim.Ki = +kiS.value;
kpV.textContent = sim.Kp.toFixed(2); kiV.textContent = sim.Ki.toFixed(2);
updGainFx();

// ── Train panel (built once, buttons use stable IDs) ──────
function buildTrainPanel() {
    trP.innerHTML = '';
    trP.style.gap = '8px'; // Add some gap between cards
    sim.trains.forEach(tr => {
        const card = document.createElement('div');
        card.className = 'tr-card';
        card.style.borderLeftColor = tr.color;
        card.id = 'tr_card_' + tr.id;

        // --- Header Section ---
        const header = document.createElement('div');
        header.className = 'tr-card-header';

        const name = document.createElement('div');
        name.className = 'tr-name';
        name.textContent = 'Train ' + tr.name;

        const badge = document.createElement('div');
        badge.className = 'tr-status-badge tbadge-free';
        badge.id = 'badge_' + tr.id;
        badge.textContent = 'FREE';

        const speedBlock = document.createElement('div');
        speedBlock.className = 'tr-speed-block';
        speedBlock.innerHTML = `
            <div><span class="tr-speed" id="spd_${tr.id}">0.0</span><span class="tr-speed-unit"> m/s</span></div>
            <div class="tr-vbar-wrap"><div class="tr-vbar-fill" id="vbar_${tr.id}" style="background:${tr.color}; width:0%"></div></div>
        `;

        header.appendChild(name);
        header.appendChild(badge);
        header.appendChild(speedBlock);

        // --- Body Section ---
        const body = document.createElement('div');
        body.className = 'tr-card-body';

        // 1. Track Selectors
        const trkRow = document.createElement('div');
        trkRow.className = 'tr-tracks-row';
        const trkLbl = document.createElement('div');
        trkLbl.className = 'tr-tracks-label'; trkLbl.textContent = 'LANE';
        const tks = document.createElement('div'); tks.className = 'tr-tracks';
        for (let t = 0; t < NUM_TRACKS; t++) {
            const b = document.createElement('button');
            b.className = 'tbtn' + (tr.track === t ? ' active' : '');
            b.id = 'tbtn_' + tr.id + '_' + t;
            b.textContent = t + 1;
            b.onclick = () => {
                sim.moveTrain(tr.id, t);
                for (let tt = 0; tt < NUM_TRACKS; tt++) {
                    const tb = document.getElementById('tbtn_' + tr.id + '_' + tt);
                    if (tb) tb.className = 'tbtn' + (tt === t ? ' active' : '');
                }
                buildCouplingPanel();
            };
            tks.appendChild(b);
        }
        trkRow.appendChild(trkLbl); trkRow.appendChild(tks);

        // 2. Mode Buttons
        const modeRow = document.createElement('div');
        modeRow.className = 'tr-mode-row';
        [
            { m: 'accelerate', cls: 'ac', lbl: '⚡ Acc' },
            { m: 'cruise',     cls: 'cr', lbl: '⚓ Cru' },
            { m: 'brake',      cls: 'br', lbl: '🛑 Brk' },
        ].forEach(({ m, cls, lbl }) => {
            const b = document.createElement('button');
            b.id = 'mbtn_' + tr.id + '_' + m;
            b.className = 'mbtn ' + cls + (tr.mode === m ? ' on' : '');
            b.textContent = lbl;
            b.onclick = () => {
                sim.setTrainMode(tr.id, m);
                ['accelerate', 'cruise', 'brake'].forEach(mm => {
                    const el = document.getElementById('mbtn_' + tr.id + '_' + mm);
                    if (el) el.className = el.className.replace(' on', '') + (mm === m ? ' on' : '');
                });
                // Toggle slider disabled state
                const slider = document.getElementById('cset_' + tr.id);
                if (slider) slider.disabled = (m !== 'cruise');
            };
            modeRow.appendChild(b);
        });

        // 3. Cruise Speed Slider
        const cruRow = document.createElement('div');
        cruRow.className = 'tr-cruise-row';
        const cruLbl = document.createElement('div');
        cruLbl.className = 'tr-cruise-label'; cruLbl.textContent = 'SET';
        
        const cruSlider = document.createElement('input');
        cruSlider.type = 'range';
        cruSlider.className = 'tr-speed-slider';
        cruSlider.id = 'cset_' + tr.id;
        cruSlider.min = '2'; cruSlider.max = '22'; cruSlider.step = '0.5';
        cruSlider.value = tr.targetV;
        cruSlider.disabled = (tr.mode !== 'cruise');

        const cruVal = document.createElement('div');
        cruVal.className = 'tr-cruise-val';
        cruVal.id = 'cval_' + tr.id;
        cruVal.textContent = tr.targetV.toFixed(1);

        cruSlider.oninput = (e) => {
            const val = +e.target.value;
            tr.targetV = val;
            cruVal.textContent = val.toFixed(1);
        };

        cruRow.appendChild(cruLbl); cruRow.appendChild(cruSlider); cruRow.appendChild(cruVal);

        body.appendChild(trkRow);
        body.appendChild(modeRow);
        body.appendChild(cruRow);

        card.appendChild(header);
        card.appendChild(body);
        trP.appendChild(card);
    });
}

// ── Coupling panel (rebuilt when pairs change) ─────────────
let _lastPairSig = '';
function buildCouplingPanel() {
    // Build a signature string representing current pairs+coupling state
    const pairs = sim.getAllPairs();
    const sig = pairs.map(p => p.leader.id + '-' + p.follower.id + ':' + sim.isCoupled(p.leader, p.follower)).join('|');
    if (sig === _lastPairSig) return;  // nothing changed, skip rebuild
    _lastPairSig = sig;

    cpP.innerHTML = '';
    if (!pairs.length) {
        cpP.innerHTML = '<p class="muted">Put 2+ trains on same track to see coupling</p>';
        return;
    }
    pairs.forEach(({ leader: l, follower: f }) => {
        const cp  = sim.isCoupled(l, f);
        const row = document.createElement('div'); row.className = 'pair-row';

        // Color dots
        const dots = document.createElement('div'); dots.className = 'pair-dots';
        ['pdot','parr','pdot'].forEach((cls, i) => {
            const el = document.createElement(i===1 ? 'span' : 'div');
            el.className = cls;
            if (i===0) el.style.background = f.color;
            if (i===1) el.textContent = '→';
            if (i===2) el.style.background = l.color;
            dots.appendChild(el);
        });

        // Label
        const lbl = document.createElement('span');
        lbl.className = 'pair-label';
        lbl.textContent = f.name + ' follows ' + l.name + ' (T'+(l.track+1)+')';

        // Badge
        const badge = document.createElement('span');
        badge.className = 'pair-badge ' + (cp ? 'pb-on' : 'pb-off');
        badge.textContent = cp ? '50m VC' : '180m';

        // Button
        const btn = document.createElement('button');
        if (cp) {
            btn.className = 'pair-btn btn-dc'; btn.textContent = '✂ Decouple';
            btn.onclick = () => { sim.decouple(l, f); _lastPairSig = ''; buildCouplingPanel(); };
        } else {
            btn.className = 'pair-btn btn-cp'; btn.textContent = '⚡ Couple';
            btn.onclick = () => { sim.couple(l, f); _lastPairSig = ''; buildCouplingPanel(); };
        }

        row.appendChild(dots); row.appendChild(lbl); row.appendChild(badge); row.appendChild(btn);
        cpP.appendChild(row);
    });
}

// ── Metrics panel ──────────────────────────────────
function updMetrics() {
    const t = sim.telem, m = sim.metrics;
    const hasCoupled = sim.getAllPairs().some(p => sim.isCoupled(p.leader, p.follower));
    const set = (id, txt, col) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = txt;
        el.style.color  = col || '#111';
    };
    if (!hasCoupled) {
        ['mGap','mErr','mP','mI','mOut','mOS','mPOS','mOsc'].forEach(id => set(id,'—','#aaa'));
        set('mStat', 'No active coupling', '#aaa');
        return;
    }
    set('mGap',  t.gap.toFixed(1) + ' m');
    set('mErr',  t.gapErr.toFixed(2) + ' m', t.gapErr < 0 ? '#c00' : '#080');
    set('mP',    t.pTerm.toFixed(3), '#2196F3');
    set('mI',    t.iTerm.toFixed(3), '#FF9800');
    set('mOut',  t.output.toFixed(3), t.output < 0 ? '#c00' : '#111');
    set('mOS',   m.overshoot.toFixed(1) + '%', m.overshoot > 5 ? '#c00' : '#080');
    set('mPOS',  m.peakOS.toFixed(1) + '%',    m.peakOS > 10 ? '#c00' : '#080');
    set('mOsc',  String(m.oscillations),        m.oscillations > 4 ? '#c00' : '#080');
    if (m.settled) set('mStat','✅ Stable', '#080');
    else if (m.oscillations > 4) set('mStat','⚠️ Oscillating', '#e70');
    else if (m.overshoot > 5)    set('mStat','🔴 Overshoot', '#c00');
    else set('mStat','⏳ Converging…','#888');
}

// Update speed labels without full rebuild
function updSpeedLabels() {
    const pairs = sim.getAllPairs();
    sim.trains.forEach(tr => {
        // Speed text
        const sEl = document.getElementById('spd_' + tr.id);
        if (sEl) sEl.textContent = tr.v.toFixed(1);

        // Velocity bar
        const vbEl = document.getElementById('vbar_' + tr.id);
        if (vbEl) {
            const pct = Math.max(0, Math.min(100, (tr.v / tr.maxV) * 100));
            vbEl.style.width = pct + '%';
        }

        // Status badge
        const bdg = document.getElementById('badge_' + tr.id);
        if (bdg) {
            let state = 'FREE';
            let cls = 'tbadge-free';

            const isCoupled = pairs.some(p => (p.follower.id === tr.id || p.leader.id === tr.id) && sim.isCoupled(p.leader, p.follower));
            
            if (isCoupled) {
                state = 'COUPLED';
                cls = 'tbadge-coupled';
            }
            if (tr.a <= -tr.maxB * 0.8) {
                state = 'BRAKING';
                cls = 'tbadge-braking'; // Braking overrides coupled badge locally
            }

            bdg.textContent = state;
            bdg.className = 'tr-status-badge ' + cls;
        }
    });
}

buildTrainPanel();
buildCouplingPanel();

// ── Track geometry ─────────────────────────────────
const TYS = 52;
function tY(ti, H)   { return (H - (NUM_TRACKS-1)*TYS)/2 + ti*TYS; }
function tX0(W)       { return 55; }
function tX1(W)       { return W - 15; }
function sToX(s, W)  { return tX0(W) + (s % TRACK_LENGTH) / TRACK_LENGTH * (tX1(W)-tX0(W)); }
function smoothstep(t){ t=Math.max(0,Math.min(1,t)); return t*t*(3-2*t); }

// ── S-curve switch rendering ────────────────────────
function drawSCurves(ctx, W, H) {
    for (let i=0; i<SWITCH_CENTERS.length; i++) {
        const cs = SWITCH_CENTERS[i];
        const x0 = sToX(cs - SWITCH_HALF, W);
        const x1 = sToX(cs + SWITCH_HALF, W);
        const y0 = tY(i,   H);
        const y1 = tY(i+1, H);

        // Curved rail (2 rails, ±3px gauge)
        for (const g of [-3, 3]) {
            ctx.beginPath();
            ctx.strokeStyle = '#888'; ctx.lineWidth = 1.5;
            const N = 30;
            for (let k=0; k<=N; k++) {
                const t = k/N;
                const x = x0 + (x1-x0)*t;
                const y = y0 + (y1-y0)*smoothstep(t) + g;
                k===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
            }
            ctx.stroke();
        }

        // Crossties along S-curve
        ctx.strokeStyle = '#ccc'; ctx.lineWidth = 1;
        for (let k=0; k<=10; k++) {
            const t = k/10;
            const cx = x0 + (x1-x0)*t;
            const cy = y0 + (y1-y0)*smoothstep(t);
            ctx.beginPath(); ctx.moveTo(cx, cy-5); ctx.lineTo(cx, cy+5); ctx.stroke();
        }

        // Switch label
        ctx.font = '7px Inter'; ctx.fillStyle = '#ccc';
        ctx.textAlign = 'center';
        ctx.fillText('S', (x0+x1)/2, (y0+y1)/2-8);
    }
}

// ── Straight tracks ────────────────────────────────
function drawTracks(ctx, W, H) {
    const x0 = tX0(W), x1 = tX1(W);
    for (let ti=0; ti<NUM_TRACKS; ti++) {
        const y = tY(ti, H);
        // Crossties
        ctx.strokeStyle = '#e0e0e0'; ctx.lineWidth = 1;
        for (let x=x0; x<=x1; x+=12) {
            ctx.beginPath(); ctx.moveTo(x, y-5); ctx.lineTo(x, y+5); ctx.stroke();
        }
        // Rails
        ctx.strokeStyle = '#777'; ctx.lineWidth = 1.5;
        for (const g of [-3, 3]) {
            ctx.beginPath(); ctx.moveTo(x0, y+g); ctx.lineTo(x1, y+g); ctx.stroke();
        }
        // Track label
        ctx.font = 'bold 9px Inter'; ctx.fillStyle = '#bbb';
        ctx.textAlign = 'right';
        ctx.fillText('T'+(ti+1), x0-5, y+3);
    }
}

// ── Train visual Y (smooth S-curve lane-change) ────
function trainVY(t, H) {
    if (t.transitionT > 0) {
        const p = smoothstep(1 - t.transitionT / t.transDur);
        return tY(t.oldTrack, H) + (tY(t.track, H) - tY(t.oldTrack, H)) * p;
    }
    return tY(t.track, H);
}

// ── Train body ─────────────────────────────────────
function drawTrain(ctx, t, W, H) {
    const x = sToX(t.s, W), y = trainVY(t, H);
    const bW=24, bH=10;
    ctx.save(); ctx.translate(x, y);
    // Body
    ctx.fillStyle = t.color;
    ctx.fillRect(-bW/2, -bH/2, bW, bH);
    ctx.strokeStyle = '#222'; ctx.lineWidth = 1;
    ctx.strokeRect(-bW/2, -bH/2, bW, bH);
    // Cabin highlight
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(-bW/2+2, -bH/2+2, bW/3, bH-4);
    // Arrow
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.moveTo(bW/2-2,0); ctx.lineTo(bW/2-5,-2.5); ctx.lineTo(bW/2-5,2.5); ctx.closePath(); ctx.fill();
    ctx.restore();
    // Name label above
    ctx.font = 'bold 9px Inter'; ctx.fillStyle = t.color; ctx.textAlign = 'center';
    ctx.fillText(t.name, x, y - 13);
    // Speed below
    ctx.font = '7px JetBrains Mono,monospace'; ctx.fillStyle = '#999';
    ctx.fillText(t.v.toFixed(1), x, y + 19);
}

// ── Coupling links ─────────────────────────────────
function drawLinks(ctx, W, H) {
    const x0 = tX0(W), x1 = tX1(W);
    sim.getAllPairs().forEach(({ leader: l, follower: f }) => {
        const cp  = sim.isCoupled(l, f);
        const y   = tY(l.track, H);
        const fX  = sToX(f.s, W) + 12;
        const lX  = sToX(l.s, W) - 12;
        const gap = sim.gap(l, f);

        ctx.save();
        ctx.strokeStyle = cp ? '#080' : '#c00';
        ctx.lineWidth   = cp ? 2.5 : 1.2;
        ctx.setLineDash(cp ? [] : [5, 3]);

        if (lX >= fX) {
            ctx.beginPath(); ctx.moveTo(fX, y); ctx.lineTo(lX, y); ctx.stroke();
        } else {
            ctx.beginPath(); ctx.moveTo(fX, y); ctx.lineTo(x1, y); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(lX, y); ctx.stroke();
        }
        ctx.setLineDash([]);

        const mx = lX >= fX ? (fX+lX)/2 : (fX+x1)/2;
        ctx.font = 'bold 8px JetBrains Mono,monospace'; ctx.textAlign = 'center';
        ctx.fillStyle = cp ? '#080' : '#c00';
        ctx.fillText(gap.toFixed(0)+'m', mx, y-7);
        ctx.font = '7px Inter'; ctx.fillStyle = '#bbb';
        ctx.fillText(cp ? 'VC 50m target' : 'fixed-block 180m', mx, y+25);
        ctx.restore();
    });
}

function drawSim() {
    const W=simC.width, H=simC.height;
    sCtx.clearRect(0,0,W,H);
    drawTracks(sCtx,W,H);
    drawSCurves(sCtx,W,H);
    drawLinks(sCtx,W,H);
    sim.trains.forEach(t => drawTrain(sCtx,t,W,H));
}

// ── PI Controller Chart ────────────────────────────
// Shows P term, I term, Output, Gap Error — all auto-scaled
function drawPIChart() {
    const W=piC.width, H=piC.height;
    pCtx.clearRect(0,0,W,H);

    const hasCoupled = sim.getAllPairs().some(p => sim.isCoupled(p.leader, p.follower));
    if (!hasCoupled || piHist.length < 2) {
        pCtx.font='12px Inter'; pCtx.fillStyle='#ccc';
        pCtx.textAlign='center';
        pCtx.fillText('⚡ Couple trains to see PI controller response', W/2, H/2);
        return;
    }

    const mid = H/2;
    // Auto-scale: find max absolute value across all signals
    let maxAbs = 0.01;
    piHist.forEach(d => {
        maxAbs = Math.max(maxAbs, Math.abs(d.p), Math.abs(d.i), Math.abs(d.out), Math.abs(d.e)*0.1);
    });
    const sc  = (H/2 - 8) / maxAbs;
    const dx   = W / HIST;

    // Grid lines
    pCtx.strokeStyle = '#f0f0f0'; pCtx.lineWidth = 1;
    pCtx.beginPath(); pCtx.moveTo(0, mid); pCtx.lineTo(W, mid); pCtx.stroke();
    for (const frac of [0.25, 0.5, 0.75]) {
        pCtx.beginPath(); pCtx.moveTo(0, mid - frac*maxAbs*sc); pCtx.lineTo(W, mid - frac*maxAbs*sc); pCtx.stroke();
        pCtx.beginPath(); pCtx.moveTo(0, mid + frac*maxAbs*sc); pCtx.lineTo(W, mid + frac*maxAbs*sc); pCtx.stroke();
    }

    // Draw a signal
    const drawSig = (key, scale, color, width, dash) => {
        pCtx.beginPath();
        pCtx.strokeStyle = color; pCtx.lineWidth = width;
        pCtx.setLineDash(dash || []);
        for (let i=0; i<piHist.length; i++) {
            const x = i * dx;
            const y = Math.max(2, Math.min(H-2, mid - piHist[i][key] * scale * sc));
            i===0 ? pCtx.moveTo(x,y) : pCtx.lineTo(x,y);
        }
        pCtx.stroke(); pCtx.setLineDash([]);
    };

    drawSig('e',   0.1,  '#f44336', 1.5, [4,2]);  // gap error ÷10 so it fits
    drawSig('p',   1,    '#2196F3', 2);
    drawSig('i',   1,    '#FF9800', 2);
    drawSig('out', 1,    '#111',    2.5);

    // Live value labels
    const t = sim.telem;
    pCtx.font = '8px JetBrains Mono,monospace'; pCtx.textAlign = 'left';
    const labels = [
        { text:'Err='+t.gapErr.toFixed(1)+'m',  color:'#f44336' },
        { text:'P='+  t.pTerm.toFixed(3),        color:'#2196F3' },
        { text:'I='+  t.iTerm.toFixed(3),        color:'#FF9800' },
        { text:'Out='+t.output.toFixed(3),       color:'#111'    },
    ];
    labels.forEach((lb, i) => {
        pCtx.fillStyle = lb.color;
        pCtx.fillText(lb.text, 4, 10 + i*10);
    });

    // Zero label
    pCtx.fillStyle='#ccc'; pCtx.textAlign='right'; pCtx.font='7px Inter';
    pCtx.fillText('0', W-3, mid+3);
    pCtx.fillText('+'+maxAbs.toFixed(1), W-3, 8);
    pCtx.fillText('-'+maxAbs.toFixed(1), W-3, H-2);
}

// ── Speed Chart ────────────────────────────────────
function drawSpdChart() {
    const W=spdC.width, H=spdC.height;
    vCtx.clearRect(0,0,W,H);
    if (spdHist.length < 2) return;
    const dx=W/HIST, sc=(H-6)/28;
    sim.trains.forEach((tr, idx) => {
        vCtx.beginPath(); vCtx.strokeStyle=tr.color; vCtx.lineWidth=1.5;
        for (let i=0; i<spdHist.length; i++) {
            const x=i*dx, y=H-(spdHist[i][idx]||0)*sc;
            i===0 ? vCtx.moveTo(x,y) : vCtx.lineTo(x,y);
        }
        vCtx.stroke();
        // Train label at right edge
        if (spdHist.length > 5) {
            vCtx.fillStyle=tr.color; vCtx.font='7px Inter'; vCtx.textAlign='left';
            const lastV = spdHist[spdHist.length-1][idx]||0;
            vCtx.fillText(tr.name, W-18, H-lastV*sc-2);
        }
    });
    vCtx.fillStyle='#ccc'; vCtx.font='7px Inter'; vCtx.textAlign='right';
    vCtx.fillText('25', W-20, H-25*sc+8);
    vCtx.fillText('0', W-20, H-2);
}

// ── Main loop ──────────────────────────────────────
let lastT = performance.now(), tick=0;
function loop(ts) {
    const dt = Math.min((ts-lastT)/1000, 0.05);
    lastT = ts;

    sim.update(dt);

    // History
    spdHist.push(sim.trains.map(t => t.v));
    if (spdHist.length > HIST) spdHist.shift();

    const hasCoupled = sim.getAllPairs().some(p => sim.isCoupled(p.leader, p.follower));
    if (hasCoupled) {
        piHist.push({ p: sim.telem.pTerm, i: sim.telem.iTerm, out: sim.telem.output, e: sim.telem.gapErr });
        if (piHist.length > HIST) piHist.shift();
    }

    drawSim();
    drawPIChart();
    drawSpdChart();

    if (++tick >= 8) {          // ~8Hz UI updates (no DOM rebuild unless pairs change)
        tick = 0;
        updSpeedLabels();
        updMetrics();
        buildCouplingPanel();   // safe: only rebuilds when pair sig changes
    }

    requestAnimationFrame(loop);
}
requestAnimationFrame(t => { lastT=t; loop(t); });
