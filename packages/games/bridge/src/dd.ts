/** Small double-dummy solver (alpha-beta over tricks, transposition table on rank-normalised hands).
 * Hands: [seat 0..3][suit 0..3] -> 13-bit rank mask (bit 12 = ace). Seats 0/2 are "NS" (the maximising side). Suits: 0=C 1=D 2=H 3=S, trump -1 = no trump. */
export type DHands = number[][];
const popc = (x: number) => { let n = 0; while (x) { x &= x - 1; n++; } return n; };
export class NodeLimit extends Error {}

export class DD {
  private tt = new Map<string, [number, number]>();
  nodes = 0;
  private trump: number; private limit: number;
  constructor(trump: number, limit = Infinity) { this.trump = trump; this.limit = limit; }

  private key(h: DHands, leader: number): string {
    let k = String(leader);
    for (let s = 0; s < 4; s++) {
      const u = h[0]![s]! | h[1]![s]! | h[2]![s]! | h[3]![s]!;
      const idx: number[] = []; let n = 0;
      for (let b = 0; b < 13; b++) if (u & (1 << b)) idx[b] = n++;
      for (let p = 0; p < 4; p++) { let m = 0; const hm = h[p]![s]!; for (let b = 0; b < 13; b++) if (hm & (1 << b)) m |= 1 << idx[b]!; k += "," + m; }
    }
    return k;
  }

  /** Tricks (of `left`) that NS win, with `cur` cards already in the current trick ([seat, suit, bit]) and `seat` to play. Exact value by zero-window search. */
  value(h: DHands, seat: number, cur: [number, number, number][], left: number): number {
    if (cur.length === 4) {                                   // the trick is complete: score it, continue from the winner
      let ws = -1, wb = -1, wseat = -1;
      for (const c of cur) { if (wseat < 0 || (c[1] === ws ? c[2]! > wb : (c[1] === this.trump && ws !== this.trump))) { ws = c[1]!; wb = c[2]!; wseat = c[0]!; } }
      return (wseat % 2 === 0 ? 1 : 0) + (left > 1 ? this.value(h, wseat, [], left - 1) : 0);
    }
    let lo = 0, hi = left;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (this.canMid(h, seat, cur, mid, left)) lo = mid; else hi = mid - 1; }
    return lo;
  }
  canMid(h: DHands, seat: number, cur: [number, number, number][], need: number, left: number): boolean {
    if (need <= 0) return true; if (need > left) return false;
    if (cur.length === 0) return this.can(h, seat, need, left);
    return this.trick(h, cur, seat, need, left);
  }

  /** Tricks the leader can certainly cash from the top (no trump issues: only used when no one can ruff). */
  private quick(h: DHands, leader: number): number {
    const t = this.trump;
    if (t >= 0) { const tm = h[0]![t]! | h[1]![t]! | h[2]![t]! | h[3]![t]!; if (tm) { const opp = h[(leader + 1) % 4]![t]! | h[(leader + 3) % 4]![t]!; if (opp) return 0; } }
    let q = 0;
    for (let s = 0; s < 4; s++) {
      const u = h[0]![s]! | h[1]![s]! | h[2]![s]! | h[3]![s]!; const m = h[leader]![s]!;
      if (!m) continue;
      let n = 0;
      for (let b = 12; b >= 0; b--) { if (!(u & (1 << b))) continue; if (m & (1 << b)) n++; else break; }
      q += n;
    }
    return q;
  }

  private can(h: DHands, leader: number, need: number, left: number): boolean {
    if (need <= 0) return true; if (need > left || left === 0) return false;
    if (this.quick(h, leader) >= need && leader % 2 === 0) return true;
    if (leader % 2 === 1 && this.quick(h, leader) > left - need) return false;                     // the defenders cash enough to hold NS below `need`
    const k = this.key(h, leader); let e = this.tt.get(k);
    if (e) { if (need <= e[0]) return true; if (need > e[1]) return false; } else { e = [0, left]; this.tt.set(k, e); }
    const r = this.trick(h, [], leader, need, left);
    if (r) e[0] = Math.max(e[0], need); else e[1] = Math.min(e[1], need - 1);
    return r;
  }

  private trick(h: DHands, cur0: [number, number, number][], seat0: number, need: number, left: number): boolean {
    const trump = this.trump;
    const cur = cur0.slice();
    const union = [0, 0, 0, 0];
    for (let s = 0; s < 4; s++) union[s] = h[0]![s]! | h[1]![s]! | h[2]![s]! | h[3]![s]!;
    for (const c of cur) union[c[1]!]! |= 1 << c[2]!;
    const step = (seat: number): boolean => {
      if (++this.nodes > this.limit) throw new NodeLimit();
      const pos = cur.length, hand = h[seat]!;
      const led = pos ? cur[0]![1]! : -1;
      let ws = -1, wb = -1, wseat = -1;
      for (const c of cur) { if (wseat < 0 || (c[1] === ws ? c[2]! > wb : (c[1] === trump && ws !== trump))) { ws = c[1]!; wb = c[2]!; wseat = c[0]!; } }
      const cands: [number, number][] = [];
      const addSuit = (s: number) => {
        const m = hand[s]!; let prev = -1;
        for (let b = 12; b >= 0; b--) {
          if (!(m & (1 << b))) continue;
          let eq = false;
          if (prev >= 0) { const between = union[s]! & ((1 << prev) - 1) & ~((1 << (b + 1)) - 1); eq = (between & ~m) === 0; }
          if (!eq) cands.push([s, b]);
          prev = b;
        }
      };
      if (pos === 0) for (let s = 0; s < 4; s++) addSuit(s);
      else if (hand[led]) addSuit(led); else for (let s = 0; s < 4; s++) addSuit(s);
      // ordering
      const partnerWins = pos > 0 && (wseat + seat) % 2 === 0;
      const beats = (s: number, b: number) => pos > 0 && (s === ws ? b > wb : (s === trump && ws !== trump));
      cands.sort((a, b) => {
        if (pos === 0) { const ta = a[1] === 12 ? 100 : 0, tb = b[1] === 12 ? 100 : 0; return tb + b[1] - (ta + a[1]); }
        if (partnerWins) return a[1] - b[1];
        const wa = beats(a[0], a[1]), wb2 = beats(b[0], b[1]);
        if (wa !== wb2) return wa ? -1 : 1;
        return a[1] - b[1];
      });
      const max = seat % 2 === 0;
      for (const [s, b] of cands) {
        hand[s]! ^= 1 << b;
        cur.push([seat, s, b]);
        let res: boolean;
        if (cur.length === 4) {
          let ws2 = -1, wb3 = -1, wseat2 = -1;
          for (const c of cur) { if (wseat2 < 0 || (c[1] === ws2 ? c[2]! > wb3 : (c[1] === trump && ws2 !== trump))) { ws2 = c[1]!; wb3 = c[2]!; wseat2 = c[0]!; } }
          const saved = cur.splice(0, 4);
          res = this.can(h, wseat2, wseat2 % 2 === 0 ? need - 1 : need, left - 1);
          cur.push(...saved);
        } else res = step((seat + 1) % 4);
        cur.pop(); hand[s]! ^= 1 << b;
        if (max ? res : !res) return max;
      }
      return !max;
    };
    // in a mid-trick call, the played cards already left the hands; `union` includes them (approximation for equivalence only)
    return step(seat0);
  }
}

export const maskCount = (h: number[]) => h.reduce((a, m) => a + popc(m), 0);
