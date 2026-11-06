// Test helpers: a machine with disks, and a script of [wait for, type]
import { readFileSync } from 'fs';
import { gunzipSync } from 'zlib';
import { Z80 } from '../z80.js';
import { Model2, CPU_HZ } from '../m2.js';
import { loadDisk } from '../floppy.js';

const here = f => new URL('../' + f, import.meta.url);
export function hd(f) {
  let b = readFileSync(here(f));
  if (b[0] === 0x1F) b = gunzipSync(b);
  return new Uint8Array(b);
}
export async function floppy(f) {
  return loadDisk(new Uint8Array(readFileSync(here(f))), f.split('/').pop());
}
export function machine(hdimg, floppies = []) {
  const m = new Model2(Z80, hdimg);
  floppies.forEach((d, i) => { m.fdc.drives[i] = d; });
  return m;
}
// Run the steps: each waits (up to secs of emulated time) for its text on
// the last line of the screen, then types its line. Returns the screen.
export function script(m, steps, secs = 120, log = false) {
  steps = steps.slice();
  let seen = '';
  for (let t = 0; t < secs * 10 && steps.length; t++) {
    m.run(CPU_HZ / 10);
    const scr = m.text();
    const last = scr.split('\n').filter(x => x.trim()).pop() || '';
    if (!m.keyq.length && last.trimEnd().endsWith(steps[0][0]) && scr !== seen) {
      if (log) console.log('>> ' + steps[0][1]);
      seen = scr;
      const s = steps.shift()[1];
      if (s !== null) for (const ch of s + '\r') m.key(ch.charCodeAt(0));
    }
  }
  for (let t = 0; t < 30; t++) m.run(CPU_HZ / 10);
  return { screen: m.text(), left: steps.length };
}
