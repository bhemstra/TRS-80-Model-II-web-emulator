// test.mjs: boot the disks in disks/ under Node and use the floppy drives
// from Fuzix and LS-DOS. Takes a minute or two.
//
//   node test/test.mjs
import { hd, floppy, machine, script } from './harness.mjs';
import { Disk, loadDisk, toIMD, toDMK } from '../floppy.js';

let fails = 0;
function expect(what, ok, screen) {
  console.log((ok ? 'ok   ' : 'FAIL ') + what);
  if (!ok) { fails++; console.log(screen); }
}
const lsdosLogin = [['?', '11/06/26'], ['?', '12:00:00']];
const lsdos = (disks, cmds, secs = 300) => {
  const m = machine(hd('disks/lsdos631n-hd.hdv.gz'), disks);
  m.bootHd();
  return script(m, [...lsdosLogin, ...cmds.map(c => ['Ready', c]), ['Ready', null]], secs);
};
const fuzixLogin = [['new date:', ''], ['new time:', ''], ['login:', 'root']];

// Fuzix from the hard disk, a file system floppy in drive 2
{
  const fd = await floppy('disks/bootds.imd');
  let m = machine(hd('disks/hard2-0.hdv.gz'), [null, fd]);
  m.bootHd();
  let r = script(m, [...fuzixLogin, ['#', 'mount /dev/fd1 /mnt'], ['#', 'echo hallo > /mnt/x'],
    ['#', 'umount /mnt'], ['#', null]], 200);
  m = machine(hd('disks/hard2-0.hdv.gz'), [null, fd]);
  m.bootHd();
  r = script(m, [...fuzixLogin, ['#', 'mount /dev/fd1 /mnt'], ['#', 'cat /mnt/x'], ['#', 'df'], ['#', null]], 200);
  expect('Fuzix: write a floppy file system, read it after a reboot', /\nhallo\n/.test(r.screen), r.screen);
  expect('Fuzix: df shows /dev/fd1', /\/dev\/fd1 +1652 /.test(r.screen), r.screen);
}

// Fuzix from floppy, as the floppy boot ROM starts it
for (const [disk, root, dev] of [['disks/boot.imd', 'hda2', '/dev/hda2'], ['disks/bootds.imd', 'fda', '/dev/fd0']]) {
  const m = machine(hd('disks/hard2-0.hdv.gz'), [await floppy(disk)]);
  const ok = m.bootFloppy();
  const r = script(m, [['bootdev:', root], ...fuzixLogin, ['#', 'df'], ['#', null]], 200);
  expect('Fuzix: boots from ' + disk + ', root ' + dev, ok && new RegExp(dev + ' .*% /').test(r.screen), r.screen);
}

// LS-DOS from the hard disk: the data floppy as :1, a blank one formatted as :2
{
  const data = await floppy('disks/lsdos-data.imd.gz');
  const blank = new Disk('blank');
  let r = lsdos([data, blank], ['FORMAT :2 (N="TWEE",M="PASSWORD",DDEN,SIDES=1,ABS)',
    'COPY NOTICE/TXT:0 :1', 'COPY BACKUP/CMD:0 :2', 'FREE']);
  expect('LS-DOS: FORMAT :2 on a blank floppy', /Formatting complete/.test(r.screen), r.screen);
  expect('LS-DOS: FREE sees :1 and :2', /Drive :1  DATA .*Free Space[\s\S]*Drive :2  TWEE .*Free Space/.test(r.screen), r.screen);
  // save both, load them back, swap the drives
  const d1 = await loadDisk(toIMD(data), 'data.imd'), d2 = await loadDisk(toDMK(blank), 'twee.dmk');
  r = lsdos([d2, d1], ['DIR :1', 'DIR :2']);
  expect('LS-DOS: saved as .dmk and .imd, read back in the other drives',
    /Drive :1  TWEE[\s\S]*BACKUP\/CMD[\s\S]*Drive :2  DATA[\s\S]*NOTICE\/TXT/.test(r.screen), r.screen);
  r = lsdos([d1], ['LIST NOTICE/TXT:1']);
  expect('LS-DOS: LIST reads the file back', /Roy Soltoff holds the copyright/.test(r.screen), r.screen);
  d1.wp = true;
  r = lsdos([d1], ['COPY BACKUP/CMD:0 :1']);
  expect('LS-DOS: a write protected floppy says so', /protected/i.test(r.screen), r.screen);
}

process.exit(fails ? 1 : 0);
