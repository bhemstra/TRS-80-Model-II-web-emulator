# TRS-80 Model II web emulator

A TRS-80 Model II in a web page: the Z80, the banked memory, the screen,
the keyboard, the real time clock, the hard disk and two 8" floppy
drives. It boots from the hard disk boot ROM or from floppy, and comes
with Fuzix and LS-DOS 6.3.1 to try. The page is in Dutch.

| File          | Contents                                                     |
|---------------|--------------------------------------------------------------|
| `index.html`  | the page: screen, keyboard, disk and floppy choice, buttons for both systems |
| `m2.js`       | the Model II: memory, video, keyboard, clock, CTC, hard disk, boot ROMs |
| `floppy.js`   | the floppy drives: FD1791, Z80 DMA, disk images              |
| `z80.js`      | z80-emulator 2.3.0 and z80-base 2.0.1 by Lawrence Kesteloot (MIT), bundled with esbuild |
| `disks.json`  | the disks the page offers                                    |
| `disks/`      | the disk images (with their own licences, see `disks/README.md`) |
| `mkdisk.sh`   | puts a hard disk image in `disks/`                           |
| `test/`       | `test.mjs` boots the disks under Node and uses the floppies   |

## Use

Serve the directory with any web server and open `index.html`:

```
python3 -m http.server 8000
```

then http://localhost:8000/. It has to come over http(s), not from a
file. Nothing needs building.

On a web site, copy `index.html`, `m2.js`, `floppy.js`, `z80.js`,
`disks.json` and `disks/` into one folder. To put it in another page
(RapidWeaver, for example), use an iframe:

```html
<iframe src="/m2/index.html?embed=1" title="TRS-80 Model II"
        style="width:100%; height:1000px; border:0"></iframe>
```

Address options: `?disk=` the hard disk (file or name, `none` for none),
`?fd1=` and `?fd2=` the floppies, `?boot=fd` to start from floppy 1,
`?embed=1` without the title and the explanation.

## disks.json

```json
[
  { "name": "Fuzix (Model II)", "file": "disks/hard2-0.hdv.gz", "os": "fuzix" },
  { "name": "Fuzix-opstartfloppy", "file": "disks/boot.imd", "type": "floppy", "os": "fuzix" }
]
```

Hard disks are `.hdv` files (the xtrs/trs80gp format, with the Model II
flag in byte 8), plain, gzipped (`.gz`) or gzipped and base64 encoded
(`.b64.txt`). Floppies (`"type": "floppy"`, or a floppy file name) are
`.imd`, `.dmk`/`.dsk` or `.raw`, plain or gzipped. `"os"` (`fuzix` or
`lsdos`) picks the buttons and the explanation shown; without it the page
guesses from the name. Visitors can also load their own images; they stay
in the browser.

## The machine

- Z80 at 4 MHz, 32K fixed at 0000H, 32K pages 1-15 at 8000H (port FFH),
  video RAM at F800H, 80x24 with the 6845 cursor
- keyboard on port FCH, with its interrupt through CTC channel 3 in IM 2
  (LS-DOS uses it; Fuzix polls)
- the 30 Hz real time clock NMI
- WD1010 hard disk at C8H-CFH: drive 0, 8 heads, 32 sectors of 512 bytes
- two 8" floppy drives on the FD1791 (E4H-E7H, select latch EFH) with the
  Z80 DMA (F8H)
- the boot ROMs: from the hard disk (sectors from cylinder 0 into memory
  until one starts with `/* END BOOT */`) and from floppy (the 26 single
  density sectors of track 0 to 0E00H, `BOOT` at 1000H, `DIAG` at 1400H)

### Floppies

The controller is emulated at the level of sectors: a disk is a list of
tracks with their sectors' IDs, density, data mark (normal FBH or deleted
F8H, which LS-DOS uses for its directory) and data. Restore, seek, step
(with verify), read and write sector (also multiple), read address and
write track (formatting: the ID and data marks in the written bytes
become sectors) are there, with write protection, two sided disks, single
and double density and the index pulse. The Z80 DMA does what the
transfers between memory and the controller need, for the ways both Fuzix
and LS-DOS program it. Fuzix and LS-DOS run unchanged.

Not emulated: read track (no raw track data is kept), timing (commands
finish at once), CRC errors, the FDC interrupt.

Images: ImageDisk (`.imd`), DMK (`.dmk`, `.dsk`, as trs80gp writes them)
and plain dumps of the Model II layout (`.raw`: track 0 26 x 128 bytes
single density, the rest 26 x 256 double density, one or two sides).
Floppies are saved as `.imd` or `.dmk`. A blank floppy can be formatted
from LS-DOS (`FORMAT :1`).

In Fuzix floppy 1 and 2 are `/dev/fd0` and `/dev/fd1`; in LS-DOS booted
from the hard disk they are `:1` and `:2`.

## Tests

```
node test/test.mjs
```

Boots Fuzix from the hard disk and writes and reads a file system on a
floppy; boots Fuzix from both its boot floppies; boots LS-DOS from the
hard disk, formats a blank floppy, copies files to both drives, saves the
floppies as `.imd` and `.dmk`, reads them back in the other drives, and
checks write protection.

## Licence

The emulator (everything but `disks/` and the bundled library in
`z80.js`) is under the MIT licence, see `LICENSE`. `z80.js` holds
z80-emulator and z80-base by Lawrence Kesteloot, MIT licence, see its
header (https://github.com/lkesteloot/trs80). The disk images have their
own licences: Fuzix is GPL version 2, LS-DOS comes with a permission
notice that has to stay with it; see `disks/README.md`.
