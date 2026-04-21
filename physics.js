// ============================================================
// physics.js  –  Virtual Coupling Simulation
// COLLISION-FREE design: PI outputs a VELOCITY TARGET
// The safe approach speed is kinematically enforced first,
// then PI adjusts within that safe envelope.
// Kp/Ki still visibly change response speed and overshoot.
// ============================================================
const TRACK_LENGTH  = 1600;
const NUM_TRACKS    = 4;
const COUPLED_GAP   = 50;    // virtual coupling target gap (m)
const BRAKING_DIST  = 180;   // traditional fixed-block gap (m)
const SWITCH_CENTERS = [300, 600, 900];
const SWITCH_HALF    = 80;

// ── Train ───────────────────────────────────────────────────
class Train {
    constructor(id, name, color, track, s0) {
        this.id = id; this.name = name; this.color = color;
        this.track = track; this.s = s0;
        this.v = 0; this.a = 0;
        this.maxV = 22; this.maxA = 1.8; this.maxB = 3.0;
        this.mode = 'cruise'; this.targetV = 10;
        this.oldTrack = track; this.transitionT = 0; this.transDur = 0.8;
    }
    update(dt) {
        this.a = Math.max(-this.maxB, Math.min(this.maxA, this.a));
        this.v = Math.max(0, Math.min(this.maxV, this.v + this.a * dt));
        this.s = (this.s + this.v * dt + TRACK_LENGTH) % TRACK_LENGTH;
        if (this.transitionT > 0) this.transitionT = Math.max(0, this.transitionT - dt);
    }
}

// ── PI Controller ────────────────────────────────────────────
// Operates on gap error, outputs a VELOCITY OFFSET (m/s)
// Positive e = gap > target = follower should go FASTER than leader
// Negative e = gap < target = follower should go SLOWER than leader
//
// Chart shows P/I/Output clearly:
//   Kp↑ → P term rises → faster approach → oscillation visible
//   Ki↑ → I term accumulates → removes steady offset → overshoot visible
class PIController {
    constructor() { this.reset(); }
    reset() {
        this.integral = 0;
        this.pTerm = 0; this.iTerm = 0; this.output = 0;
    }
    // Returns velocity OFFSET relative to leader speed (m/s)
    compute(gapError, Kp, Ki, dt) {
        this.pTerm    = Kp * gapError;
        this.integral = Math.max(-500, Math.min(500, this.integral + gapError * dt));
        this.iTerm    = Ki * this.integral;
        this.output   = this.pTerm + this.iTerm;
        return this.output;   // m/s velocity offset
    }
}

// ── Simulation ───────────────────────────────────────────────
class Simulation {
    constructor() {
        this.trains = [
            new Train(0, 'A', '#cc2200', 0, 100),
            new Train(1, 'B', '#1155ee', 0, 500),
            new Train(2, 'C', '#dd7700', 1, 200),
            new Train(3, 'D', '#880099', 2, 200),
        ];
        this.coupledPairs = {};
        this.pis = {};
        this.Kp = 0.25;  // velocity offset per metre of gap error
        this.Ki = 0.02;
        this.time = 0;
        this.telem  = { pTerm: 0, iTerm: 0, output: 0, gapErr: 0, gap: 0 };
        this.metrics = { overshoot: 0, peakOS: 0, oscillations: 0, settled: false };
        this._eh = [];
    }

    _key(a, b)  { return Math.min(a.id, b.id) + '-' + Math.max(a.id, b.id); }
    _pi(a, b)   {
        const k = this._key(a, b);
        if (!this.pis[k]) this.pis[k] = new PIController();
        return this.pis[k];
    }

    gap(lead, follow) {
        const d = lead.s - follow.s;
        return d < 0 ? d + TRACK_LENGTH : d;
    }

    isCoupled(a, b)  { return !!this.coupledPairs[this._key(a, b)]; }
    couple(a, b)     {
        this.coupledPairs[this._key(a, b)] = true;
        this._pi(a, b).reset();
        this._eh = []; this.metrics.peakOS = 0;
    }
    decouple(a, b)   {
        this.coupledPairs[this._key(a, b)] = false;
        this._pi(a, b).reset();
    }

    trainsOnTrack(ti) {
        const arr = this.trains.filter(t => t.track === ti);
        if (arr.length < 2) return arr;
        arr.sort((a, b) => a.s - b.s);
        let mgi = 0, mg = 0;
        for (let i = 0; i < arr.length; i++) {
            let g = arr[(i + 1) % arr.length].s - arr[i].s;
            if (g <= 0) g += TRACK_LENGTH;
            if (g > mg) { mg = g; mgi = i; }
        }
        const r = [];
        for (let i = 0; i < arr.length; i++) r.push(arr[(mgi + 1 + i) % arr.length]);
        r.reverse();
        return r;
    }

    getAllPairs() {
        const out = [];
        for (let ti = 0; ti < NUM_TRACKS; ti++) {
            const o = this.trainsOnTrack(ti);
            for (let i = 0; i < o.length - 1; i++)
                out.push({ leader: o[i], follower: o[i + 1] });
        }
        return out;
    }

    moveTrain(id, newTrack) {
        const t = this.trains[id];
        if (t.track === newTrack) return;
        for (const k in this.coupledPairs)
            if (k.split('-').map(Number).includes(id)) this.coupledPairs[k] = false;
        t.oldTrack = t.track; t.track = newTrack; t.transitionT = t.transDur;
    }

    setTrainMode(id, mode) {
        const t = this.trains[id];
        t.mode = mode;
        if (mode === 'cruise') t.targetV = Math.max(2, t.v);
    }

    // ── main physics step ────────────────────────────────────
    update(dt) {
        this.trains.forEach(t => { t.a = 0; });
        let telemSet = false;

        for (let ti = 0; ti < NUM_TRACKS; ti++) {
            const ord = this.trainsOnTrack(ti);
            if (!ord.length) continue;

            // Step 1: Self-drive every train by its own mode
            for (const tr of ord) {
                switch (tr.mode) {
                    case 'accelerate': tr.a = tr.maxA; break;
                    case 'brake':      tr.a = -tr.maxB; break;
                    case 'cruise':     tr.a = 1.5 * (tr.targetV - tr.v); break;
                }
            }

            // Step 2: Override followers that are coupled
            for (let i = 1; i < ord.length; i++) {
                const lead = ord[i - 1], fol = ord[i];

                // ── Decoupled: Hard safety limits to prevent collision ──
                if (!this.isCoupled(lead, fol)) {
                    const g = this.gap(lead, fol);
                    
                    // Maintain at least a 30m buffer space
                    const safeDist = Math.max(0, g - 30);
                    
                    // The absolute maximum speed follower can currently go and still have enough
                    // room to brake before hitting the 30m buffer behind the leader
                    const maxSafeV = lead.v + Math.sqrt(2 * fol.maxB * safeDist) * 0.9;
                    
                    if (fol.v > maxSafeV) {
                        // Violating safety margin -> hard braking
                        fol.a = -fol.maxB;
                    } else if (g < BRAKING_DIST && fol.v > lead.v) {
                        // Early gentle slow-down when within block warning distance (180m)
                        const urgency = 1.0 - (g - 30) / (BRAKING_DIST - 30);
                        fol.a = Math.min(fol.a, -fol.maxB * urgency);
                    }
                    
                    // Hard stop override if somehow breached the buffer
                    if (g <= 30) {
                        fol.a = -fol.maxB;
                        fol.v = Math.min(fol.v, lead.v); // Cap speed immediately
                    }
                    continue;
                }

                // ── Coupled: PI velocity controller ────────────────────
                const pi  = this._pi(lead, fol);
                const g   = this.gap(lead, fol);
                const e   = g - COUPLED_GAP;   // gap error (m)

                // Shared emergency braking: if leader brakes, follower brakes identically
                if (lead.mode === 'brake') {
                    fol.a = -fol.maxB;
                    pi.compute(e, this.Kp, this.Ki, dt);  // keep integrator warm
                    if (!telemSet) { this._setTelem(pi, e, g); telemSet = true; }
                    continue;
                }

                // ── PI outputs a velocity OFFSET (m/s) on top of leader speed ──
                // This makes Kp/Ki effect immediately visible:
                //   High Kp → large velOffset → follower overshoots
                //   High Ki → integral winds up → removes steady-state error
                const velOffset = pi.compute(e, this.Kp, this.Ki, dt);

                // ── KINEMATIC SAFETY ENVELOPE (collision prevention) ──
                // Maximum SAFE approach speed given remaining gap to stop at target:
                //   v_safe = sqrt(2 * maxBrake * (g - COUPLED_GAP))
                // This is the maximum closing speed from which we can brake to
                // exactly the target distance. We enforce this as a hard ceiling
                // on the follower's absolute speed.
                const distToStop   = Math.max(0, g - COUPLED_GAP);          // room to brake
                const maxSafeV     = lead.v + Math.sqrt(2 * fol.maxB * distToStop) * 0.85;
                //                                                            ^^^^ 0.85 = safety margin

                // Desired follower speed = leader speed + PI velocity offset
                // But never exceed the kinematic safe ceiling → NO COLLISION POSSIBLE
                let vDesired = lead.v + velOffset;
                vDesired = Math.max(0, Math.min(fol.maxV, Math.min(maxSafeV, vDesired)));

                // Acceleration to reach desired speed (simple P on velocity)
                fol.a = Math.max(-fol.maxB, Math.min(fol.maxA,
                    3.0 * (vDesired - fol.v)));

                // Hard stop if gap critically small (belt-and-suspenders)
                if (g < COUPLED_GAP * 0.4) fol.a = -fol.maxB;

                if (!telemSet) { this._setTelem(pi, e, g); telemSet = true; }
            }
        }

        this.trains.forEach(t => t.update(dt));
        this.time += dt;
    }

    _setTelem(pi, e, g) {
        this.telem = { pTerm: pi.pTerm, iTerm: pi.iTerm, output: pi.output, gapErr: e, gap: g };
        this._eh.push(e);
        if (this._eh.length > 600) this._eh.shift();
        const minE = Math.min(...this._eh);
        if (minE < 0) this.metrics.peakOS = Math.max(this.metrics.peakOS, (-minE / COUPLED_GAP) * 100);
        this.metrics.overshoot = e < 0 ? (-e / COUPLED_GAP) * 100 : 0;
        let zc = 0;
        for (let j = 1; j < this._eh.length; j++)
            if (this._eh[j - 1] * this._eh[j] < 0) zc++;
        this.metrics.oscillations = zc;
        const rec = this._eh.slice(-100);
        this.metrics.settled = rec.length >= 100 && rec.every(v => Math.abs(v) < COUPLED_GAP * 0.04);
    }
}
