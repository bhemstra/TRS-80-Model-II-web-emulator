# Disks

These disk images are not covered by the MIT licence of the emulator;
each keeps its own.

| File | Contents | Licence |
|------|----------|---------|
| `hard2-0.hdv.gz` | Fuzix 0.5 for the Model II on the hard disk (boots from the hard disk boot ROM) | GPL version 2 |
| `boot.imd` | Fuzix boot floppy (single sided); answer `hda2` at `bootdev:` | GPL version 2 |
| `bootds.imd` | Fuzix boot floppy, double sided, with a small root file system; answer `fda` | GPL version 2 |
| `lsdos631n-hd.hdv.gz` | LS-DOS 6.3.1 level N on the hard disk (boots from the hard disk boot ROM) | see below |
| `lsdos-data.imd.gz` | an empty LS-DOS data floppy (FORMAT, double density, one side) | see below |

Fuzix: built from https://github.com/bhemstra/Fuzix (the Model II port,
`Kernel/platform/platform-trs80m2`), based on
https://github.com/EtchedPixels/FUZIX. The source is there.

LS-DOS: built with `zmac-build` from
https://github.com/bhemstra/TRS80_M2_LSDOS631N (branch `harddisk-boot`),
based on Michel Bernard's https://github.com/GmEsoft/TRS80_M2_LSDOS631N.
The hard disk holds NOTICE/TXT; its permission notice has to go along
with copies:

> Roy Soltoff holds the copyright to the software and documentation in
> the list below; notices that name other authors are outdated. Roy
> grants free permission to everyone to download and use this software
> and documentation and to redistribute it to others, provided this
> notice is retained. All other rights are reserved.

(The list: the MISOSYS software on Tim Mann's web page, LS-DOS 6.3.1
among it.) Copyright 1982-1984, 1986, 1990 by MISOSYS, Inc. Typed in
(and enhanced) by Pete Cervasio; changes copyright 1997-98 Peter W.
Cervasio, "permission to do whatever you want with my changes is granted,
as long as my copyright notice is left intact".
