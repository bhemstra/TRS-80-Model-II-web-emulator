#!/bin/sh
#
#	Put a Model II hard disk image in disks/ for the page.
#
#	mkdisk.sh image.hdv [name]	writes disks/<name>.hdv.gz
#	mkdisk.sh -b image.hdv [name]	writes disks/<name>.hdv.gz.b64.txt
#					(for hosts that only serve text)
#
#	The name defaults to the image's. Add the file to disks.json to make
#	it selectable. Floppy images (.imd, .dmk, .raw) can go in disks/ as
#	they are, or gzipped.
#
set -e
B64=
if [ "$1" = "-b" ]; then B64=1; shift; fi
[ -n "$1" ] || { echo "usage: $0 [-b] image.hdv [name]" >&2; exit 1; }
IMG=$1
NAME=${2:-$(basename "$IMG" .hdv)}
OUT=$(dirname "$0")/disks/$NAME.hdv.gz
if [ -n "$B64" ]; then
	gzip -9 -c "$IMG" | base64 -w0 > "$OUT.b64.txt"
	ls -l "$OUT.b64.txt"
else
	gzip -9 -c "$IMG" > "$OUT"
	ls -l "$OUT"
fi
