// TRS-80 Model II floppy disks: 8" drives on an FD1791 controller, with the
// Z80 DMA moving the data, as Fuzix and LS-DOS use them.
//
// A disk is a list of tracks, each a list of sectors as the controller
// sees them: the ID (cylinder, head, sector, size), density, data mark
// (FB normal, F8 deleted: LS-DOS marks its directory that way) and data.
// Images: ImageDisk (.imd), DMK (.dmk/.dsk as trs80gp writes them) and
// plain sector dumps of the Model II layout (.raw, as Fuzix builds them).
// Disks are saved as .imd or .dmk.
//
// Ports: E4 command/status, E5 track, E6 sector, E7 data, EF drive select
// (bits 0-3 drive 0-3, active low; bit 6 0 = side 1; bit 7 1 = MFM), F8
// the Z80 DMA.

export const REV_T = 4000000 / 6;	// one turn at 360 rpm in clock cycles

// ---- Disks

export class Disk {
  constructor(name = '') {
    this.name = name;
    this.tracks = new Map();		// cyl * 2 + head -> [sector]
    this.wp = false;
  }
  track(c, h) { return this.tracks.get(c * 2 + h) || []; }
  setTrack(c, h, secs) { this.tracks.set(c * 2 + h, secs); }
  get cyls() { let n = 0; for (const k of this.tracks.keys()) n = Math.max(n, (k >> 1) + 1); return n; }
  get sides() { for (const [k, t] of this.tracks) if ((k & 1) && t.length) return 2; return 1; }
}

const sector = (c, h, r, n, mfm, dam, data) => ({ c, h, r, n, mfm, dam, data });

// ImageDisk
function parseIMD(b, name) {
  const d = new Disk(name);
  let i = b.indexOf(0x1A);
  if (i < 0) throw new Error(name + ': geen IMD-kop');
  i++;
  while (i < b.length) {
    const mode = b[i], cyl = b[i + 1], head = b[i + 2], ns = b[i + 3], sz = b[i + 4];
    i += 5;
    const smap = b.subarray(i, i + ns); i += ns;
    let cmap = null, hmap = null;
    if (head & 0x80) { cmap = b.subarray(i, i + ns); i += ns; }
    if (head & 0x40) { hmap = b.subarray(i, i + ns); i += ns; }
    const size = 128 << sz, secs = [];
    for (let s = 0; s < ns; s++) {
      const ty = b[i++];
      let data = new Uint8Array(size);
      if (ty === 0) continue;			// not readable
      if (ty & 1) { data.set(b.subarray(i, i + size)); i += size; }
      else data.fill(b[i++]);
      const deleted = ty === 3 || ty === 4 || ty === 7 || ty === 8;
      secs.push(sector(cmap ? cmap[s] : cyl, hmap ? hmap[s] : head & 1, smap[s], sz,
        mode >= 3, deleted ? 0xF8 : 0xFB, data));
    }
    d.setTrack(cyl, head & 1, secs);
  }
  return d;
}

export function toIMD(d) {
  const out = [];
  const date = new Date(), p = (x, n = 2) => String(x).padStart(n, '0');
  const hdr = 'IMD 1.18: ' + p(date.getDate()) + '/' + p(date.getMonth() + 1) + '/' + date.getFullYear() +
    ' ' + p(date.getHours()) + ':' + p(date.getMinutes()) + ':' + p(date.getSeconds()) +
    '\r\nTRS-80 Model II web emulator\r\n\x1A';
  for (const ch of hdr) out.push(ch.charCodeAt(0));
  const keys = [...d.tracks.keys()].sort((a, b) => a - b);
  for (const k of keys) {
    const secs = d.tracks.get(k);
    if (!secs.length) continue;
    const c = k >> 1, h = k & 1;
    // IMD has one size and density per track: split if a track mixes them
    const groups = new Map();
    for (const s of secs) {
      const g = s.n * 2 + (s.mfm ? 1 : 0);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(s);
    }
    for (const [g, list] of groups) {
      const sz = g >> 1, mfm = g & 1;
      const cmap = list.some(s => s.c !== c), hmap = list.some(s => s.h !== h);
      out.push(mfm ? 3 : 0, c, h | (cmap ? 0x80 : 0) | (hmap ? 0x40 : 0), list.length, sz);
      for (const s of list) out.push(s.r);
      if (cmap) for (const s of list) out.push(s.c);
      if (hmap) for (const s of list) out.push(s.h);
      for (const s of list) {
        const del = s.dam === 0xF8 || s.dam === 0xF9;
        if (s.data.every(x => x === s.data[0])) out.push(del ? 4 : 2, s.data[0]);
        else { out.push(del ? 3 : 1); for (const x of s.data) out.push(x); }
      }
    }
  }
  return new Uint8Array(out);
}

// CRC-16/CCITT as the controller computes it over marks and data
function crc16(bytes, crc = 0xFFFF) {
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
  }
  return crc;
}

// DMK as trs80gp writes it: single density bytes doubled
export function toDMK(d) {
  const sides = d.sides, ncyl = Math.max(77, d.cyls);
  const raw = [];
  let tlen = 0x80;
  for (let c = 0; c < ncyl; c++) for (let h = 0; h < sides; h++) {
    const tab = [], bytes = [];
    const emit = (v, mfm, n = 1) => { for (let i = 0; i < n; i++) { bytes.push(v); if (!mfm) bytes.push(v); } };
    const secs = d.track(c, h);
    const mfm0 = secs.length ? secs[0].mfm : true;
    emit(mfm0 ? 0x4E : 0xFF, mfm0, mfm0 ? 80 : 40);
    for (const s of secs) {
      const m = s.mfm, gap = m ? 0x4E : 0xFF, pre = m ? [0xA1, 0xA1, 0xA1] : [];
      emit(0x00, m, m ? 12 : 6);
      if (m) emit(0xA1, m, 3);
      tab.push((0x80 + bytes.length) | (m ? 0x8000 : 0));
      const id = [0xFE, s.c, s.h, s.r, s.n];
      for (const v of id) emit(v, m);
      const ic = crc16(pre.concat(id));
      emit(ic >> 8, m); emit(ic & 0xFF, m);
      emit(gap, m, m ? 22 : 11);
      emit(0x00, m, m ? 12 : 6);
      if (m) emit(0xA1, m, 3);
      emit(s.dam, m);
      for (const v of s.data) emit(v, m);
      const dc = crc16([...s.data], crc16(pre.concat([s.dam])));
      emit(dc >> 8, m); emit(dc & 0xFF, m);
      emit(gap, m, m ? 54 : 27);
    }
    const t = new Uint8Array(0x80 + bytes.length);
    tab.forEach((v, i) => { t[i * 2] = v & 0xFF; t[i * 2 + 1] = v >> 8; });
    t.set(bytes, 0x80);
    raw.push(t);
    tlen = Math.max(tlen, t.length);
  }
  const out = new Uint8Array(16 + raw.length * tlen);
  out[0] = d.wp ? 0xFF : 0; out[1] = ncyl; out[2] = tlen & 0xFF; out[3] = tlen >> 8;
  out[4] = sides === 1 ? 0x10 : 0;
  raw.forEach((t, i) => {
    const o = 16 + i * tlen;
    out.set(t, o);
    out.fill(t[t.length - 1] ?? 0x4E, o + t.length, o + tlen);	// pad with gap
  });
  return out;
}

// DMK: raw tracks with a table of ID address marks
function parseDMK(b, name) {
  const d = new Disk(name);
  const ntr = b[1], tlen = b[2] | (b[3] << 8), flags = b[4];
  const sides = (flags & 0x10) ? 1 : 2;
  const noDouble = !!(flags & 0xC0);	// single density bytes not doubled
  d.wp = b[0] === 0xFF;
  for (let t = 0; t < ntr; t++) for (let h = 0; h < sides; h++) {
    const base = 16 + (t * sides + h) * tlen;
    if (base + tlen > b.length) break;
    const tr = b.subarray(base, base + tlen), secs = [];
    for (let k = 0; k < 64; k++) {
      const ptr = tr[k * 2] | (tr[k * 2 + 1] << 8);
      if (!ptr) break;
      const mfm = !!(ptr & 0x8000), st = (mfm || noDouble) ? 1 : 2;
      let o = ptr & 0x3FFF;
      if (tr[o] !== 0xFE) continue;
      const at = j => tr[o + j * st];
      const c = at(1), hh = at(2), r = at(3), n = at(4) & 3;
      // the data mark follows within the gap after the ID
      let j = 7, dam = 0;
      for (; j < (mfm ? 60 : 40); j++) {
        const x = at(j);
        if (x >= 0xF8 && x <= 0xFB) { dam = x; break; }
      }
      if (!dam) continue;
      const size = 128 << n, data = new Uint8Array(size);
      for (let q = 0; q < size; q++) data[q] = at(j + 1 + q);
      secs.push(sector(c, hh, r, n, mfm, dam, data));
    }
    if (secs.length) d.setTrack(t, h, secs);
  }
  return d;
}

// Plain dump in the Model II layout: cylinder 0 side 0 26 x 128 FM, the
// rest 26 x 256 MFM, 77 cylinders, one side or two (side 1 after side 0
// on each cylinder, as Fuzix' makeimd lays them out)
function parseRaw(b, name) {
  const d = new Disk(name);
  const t0 = 26 * 128, tr = 26 * 256;
  let sides;
  if (b.length === t0 + 76 * tr) sides = 1;
  else if (b.length === 2 * t0 + 76 * 2 * tr || b.length === t0 + tr + 76 * 2 * tr) sides = 2;
  else throw new Error(name + ': onbekende grootte voor een Model II-floppy');
  let o = 0;
  const take = n => { const x = b.slice(o, o + n); o += n; return x; };
  const fm0 = [];
  for (let r = 1; r <= 26; r++) fm0.push(sector(0, 0, r, 0, false, 0xFB, take(128)));
  d.setTrack(0, 0, fm0);
  if (sides === 2) {
    const s1 = [], big = b.length === 2 * t0 + 76 * 2 * tr;
    for (let r = 1; r <= 26; r++) s1.push(big ? sector(0, 1, r, 0, false, 0xFB, take(128))
      : sector(0, 1, r, 1, true, 0xFB, take(256)));
    d.setTrack(0, 1, s1);
  }
  for (let c = 1; c < 77; c++) for (let h = 0; h < sides; h++) {
    const s = [];
    for (let r = 1; r <= 26; r++) s.push(sector(c, h, r, 1, true, 0xFB, take(256)));
    d.setTrack(c, h, s);
  }
  return d;
}

// A disk from the bytes of an image file
export async function loadDisk(bytes, name) {
  if (bytes[0] === 0x1F && bytes[1] === 0x8B) {		// gzip
    const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    bytes = new Uint8Array(await new Response(s).arrayBuffer());
    name = name.replace(/\.gz$/i, '');
  }
  if (String.fromCharCode(...bytes.subarray(0, 4)) === 'IMD ') return parseIMD(bytes, name);
  if (/\.raw$/i.test(name)) return parseRaw(bytes, name);
  if (bytes.length >= 16 && (bytes[0] === 0 || bytes[0] === 0xFF) && bytes[1] > 0 && bytes[1] <= 96 &&
      (bytes[2] | (bytes[3] << 8)) > 0x80) return parseDMK(bytes, name);
  return parseRaw(bytes, name);
}

// ---- The controller, the drives and the DMA

export class FDC {
  // m: the machine, for memory (m.rd/m.wr), I/O (m.inp/m.outp) and time
  constructor(m) {
    this.m = m;
    this.drives = [null, null, null, null];	// Disk or null
    this.pos = [0, 0, 0, 0];			// head positions
    this.sel = 0xFF;				// drive select latch
    this.status = 0; this.track = 0; this.sector = 0; this.data = 0;
    this.type = 1;				// status layout of the last command
    this.busy = false; this.drq = false;
    this.dir = 1;				// last step direction
    this.buf = null; this.ptr = 0; this.cur = null; this.cmd = 0; this.wtrack = null;
    this.writing = false; this.inDma = false;
    this.dma = { wr0: 0, a: 0, b: 0, len: 0, amode: 0, bmode: 0, ca: 0, cb: 0, n: 0, on: false, follow: [] };
  }

  drive() {
    const s = ~this.sel & 0x0F;
    for (let i = 0; i < 4; i++) if (s & (1 << i)) return i;
    return -1;
  }
  disk() { const d = this.drive(); return d < 0 ? null : this.drives[d]; }
  side() { return (this.sel & 0x40) ? 0 : 1; }
  mfm() { return !!(this.sel & 0x80); }

  typeOneStatus() {
    const d = this.disk(), dr = this.drive();
    let s = this.status & 0x18;			// seek error, CRC
    if (!d) return s | 0x80 | (this.busy ? 1 : 0);
    if (d.wp) s |= 0x40;
    s |= 0x20;					// head loaded
    if (this.pos[dr] === 0) s |= 0x04;
    if ((this.m.hal.tStateCount % REV_T) < REV_T / 50) s |= 0x02;	// index
    return s | (this.busy ? 1 : 0);
  }

  readStatus() {
    if (this.type === 1) return this.typeOneStatus();
    let s = this.status & 0x7C;
    if (!this.disk()) s |= 0x80;
    return s | (this.drq ? 2 : 0) | (this.busy ? 1 : 0);
  }

  in(p) {
    switch (p) {
      case 0xE4: return this.readStatus();
      case 0xE5: return this.track;
      case 0xE6: return this.sector;
      case 0xE7: {
        if (this.drq && this.buf && !this.writing) {
          this.data = this.buf[this.ptr++];
          if (this.ptr >= this.buf.length) this.endRead();
        }
        return this.data;
      }
    }
    return 0xFF;
  }

  out(p, v) {
    switch (p) {
      case 0xE4: this.command(v); break;
      case 0xE5: this.track = v; break;
      case 0xE6: this.sector = v; break;
      case 0xE7:
        this.data = v;
        if (this.drq && this.writing) this.put(v);
        break;
      case 0xEF: this.sel = v; break;
      case 0xF8: this.dmaWrite(v); break;
    }
    if (!this.inDma) this.service();
  }

  done(status) {
    this.status = status;
    this.busy = false; this.drq = false;
    this.buf = null; this.writing = false;
  }

  findSector() {
    const d = this.disk();
    if (!d) return null;
    const dr = this.drive(), side = this.side(), mfm = this.mfm();
    for (const s of d.track(this.pos[dr], side))
      if (s.r === this.sector && s.c === this.track && s.mfm === mfm &&
          (!(this.cmd & 0x02) || s.h === ((this.cmd >> 3) & 1))) return s;
    return null;
  }

  command(v) {
    const d = this.disk(), dr = this.drive();
    if ((v & 0xF0) === 0xD0) {			// force interrupt
      this.done(this.type === 1 ? this.status & 0x18 : 0);
      this.type = 1;
      return;
    }
    if (this.busy) return;
    this.cmd = v;
    if (!(v & 0x80)) {				// type I: restore, seek, step
      this.type = 1;
      let st = 0;
      if (d) {
        const op = v >> 4;
        if (op === 0) { this.pos[dr] = 0; this.track = 0; }
        else if (op === 1) {
          this.pos[dr] = Math.max(0, Math.min(79, this.pos[dr] + this.data - this.track));
          this.track = this.data;
        } else {
          if (op >= 4) this.dir = op >= 6 ? -1 : 1;
          this.pos[dr] = Math.max(0, Math.min(79, this.pos[dr] + this.dir));
          if (op & 1) this.track = (this.track + this.dir) & 0xFF;
        }
        if ((v & 0x04) && !d.track(this.pos[dr], 0).concat(d.track(this.pos[dr], 1))
            .some(s => s.c === this.track)) st = 0x10;	// verify
      }
      this.done(st);
      return;
    }
    this.type = 2;
    if (!d) { this.done(0x80); return; }
    const op = v >> 5;
    if (op === 4 || op === 5) {			// read / write sector
      const s = this.findSector();
      if (!s) { this.done(0x10); return; }
      if (op === 5 && d.wp) { this.done(0x40); return; }
      this.cur = s;
      this.busy = true; this.drq = true; this.ptr = 0;
      this.writing = op === 5;
      this.status = (op === 4 && (s.dam === 0xF8 || s.dam === 0xF9)) ? 0x20 : 0;
      this.buf = this.writing ? new Uint8Array(s.data.length) : s.data;
    } else if (op === 6) {			// read address
      const t = d.track(this.pos[dr], this.side()).filter(s => s.mfm === this.mfm());
      if (!t.length) { this.done(0x10); return; }
      const s = t[Math.floor(this.m.hal.tStateCount / (REV_T / t.length)) % t.length];
      this.sector = s.c;
      this.cur = null; this.busy = true; this.drq = true; this.ptr = 0; this.writing = false;
      this.status = 0;
      this.buf = new Uint8Array([s.c, s.h, s.r, s.n, 0, 0]);
    } else if ((v & 0xF0) === 0xE0) {		// read track: not kept
      this.done(0x04);
    } else {					// write track (format)
      if (d.wp) { this.done(0x40); return; }
      this.busy = true; this.drq = true; this.writing = true; this.cur = null;
      this.status = 0;
      this.wtrack = []; this.buf = null;
    }
  }

  // A byte for a write command
  put(v) {
    if (this.wtrack) {
      this.wtrack.push(v);
      // without the DMA the track ends after a turn's worth of bytes
      if (this.wtrack.length >= (this.mfm() ? 12500 : 6250)) this.endFormat();
      return;
    }
    this.buf[this.ptr++] = v;
    if (this.ptr >= this.buf.length) {
      this.cur.data = this.buf;
      this.cur.dam = (this.cmd & 1) ? 0xF8 : 0xFB;
      this.next();
    }
  }

  endRead() { if (this.cur) this.next(); else this.done(0); }

  // End of a sector: the next one for a multiple sector command
  next() {
    if (this.cmd & 0x10) {
      this.sector = (this.sector + 1) & 0xFF;
      const s = this.findSector();
      if (s) {
        const wr = this.writing;
        this.cur = s; this.ptr = 0;
        this.buf = wr ? new Uint8Array(s.data.length) : s.data;
        return;
      }
      this.done(0x10);
      return;
    }
    this.done(this.status & 0x20);
  }

  // The bytes written by a write track command become sectors
  endFormat() {
    const w = this.wtrack, mfm = this.mfm(), secs = [];
    this.wtrack = null;
    for (let i = 0; i < w.length; i++) {
      if (w[i] !== 0xFE) continue;
      if (mfm && w[i - 1] !== 0xF5) continue;	// an ID needs the A1 sync
      const c = w[i + 1], h = w[i + 2], r = w[i + 3], n = w[i + 4] & 3, size = 128 << n;
      let j = i + 5;
      if (w[j] === 0xF7) j++;
      let found = -1;
      for (let k = j; k < j + 60 && k < w.length; k++)
        if (w[k] >= 0xF8 && w[k] <= 0xFB && (!mfm || w[k - 1] === 0xF5)) { found = k; break; }
      if (found < 0) continue;
      const data = new Uint8Array(size);
      for (let q = 0; q < size; q++) data[q] = w[found + 1 + q] ?? 0;
      secs.push(sector(c, h, r, n, mfm, w[found], data));
      i = found + size;
    }
    const d = this.disk();
    if (d) d.setTrack(this.pos[this.drive()], this.side(), secs);
    this.done(0);
  }

  // ---- Z80 DMA: just enough for a transfer between memory and the FDC
  dmaWrite(v) {
    const D = this.dma;
    if (D.follow.length) { D.follow.shift()(v); return; }
    const f = [];
    if ((v & 0x80) === 0 && (v & 3)) {			// WR0
      D.wr0 = v;
      if (v & 0x08) f.push(x => D.a = (D.a & 0xFF00) | x);
      if (v & 0x10) f.push(x => D.a = (D.a & 0xFF) | (x << 8));
      if (v & 0x20) f.push(x => D.len = (D.len & 0xFF00) | x);
      if (v & 0x40) f.push(x => D.len = (D.len & 0xFF) | (x << 8));
    } else if ((v & 0x87) === 0x04 || (v & 0x87) === 0x00) {	// WR1, WR2
      const mode = v & 0x38;				// I/O bit, increment bits
      if (v & 4) D.amode = mode; else D.bmode = mode;
      if (v & 0x40) f.push(() => {});		// timing
    } else if ((v & 0x83) === 0x80) {			// WR3
      if (v & 0x08) f.push(() => {});
      if (v & 0x10) f.push(() => {});
      if (v & 0x40) D.on = true;
    } else if ((v & 0x83) === 0x81) {			// WR4
      if (v & 0x04) f.push(x => D.b = (D.b & 0xFF00) | x);
      if (v & 0x08) f.push(x => D.b = (D.b & 0xFF) | (x << 8));
      if (v & 0x10) f.push(() => {});		// interrupt control
    } else if ((v & 0xC7) === 0x82) {			// WR5
    } else {						// WR6: commands
      switch (v) {
        case 0xC3: D.on = false; D.amode = D.bmode = 0; break;
        case 0xCF: D.ca = D.a; D.cb = D.b; D.n = 0; break;
        case 0xD3: D.n = 0; break;
        case 0x87: D.on = true; break;
        case 0x83: D.on = false; break;
        case 0xBB: f.push(() => {}); break;
      }
    }
    D.follow = f;
  }

  // Move bytes while the FDC asks for them and the DMA is on
  service() {
    const D = this.dma, m = this.m;
    if (!D.on || !this.drq) return;
    const len = D.len || 0x10000;
    const atob = !!(D.wr0 & 4);
    const step = (mode, x) => {
      const inc = mode & 0x30;
      return inc === 0x10 ? (x + 1) & 0xFFFF : inc === 0x00 ? (x - 1) & 0xFFFF : x;
    };
    const rd = (mode, x) => (mode & 0x08) ? m.inp(x & 0xFF) : m.rd(x);
    const wr = (mode, x, v) => { if (mode & 0x08) m.outp(x & 0xFF, v); else m.wr(x, v); };
    this.inDma = true;
    while (this.drq && D.n < len) {
      // FDC reads go to memory, writes come from memory
      let v;
      if (atob) { v = rd(D.amode, D.ca); wr(D.bmode, D.cb, v); }
      else { v = rd(D.bmode, D.cb); wr(D.amode, D.ca, v); }
      D.ca = step(D.amode, D.ca); D.cb = step(D.bmode, D.cb);
      D.n++;
    }
    this.inDma = false;
    if (D.n >= len && this.wtrack) this.endFormat();	// end of the block: the track is done
  }
}
