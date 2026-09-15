'use strict';
/**
 * A ZIP writer, in the same spirit as lib/png.js: the one format a script here
 * needs to produce, written out directly over Node's own zlib rather than
 * pulled in as a dependency.
 *
 * It exists because a .pptx is a ZIP of XML parts and nothing else. Only what
 * that needs is implemented: deflate or store, no encryption, no Zip64, no
 * directory entries, no archive comment.
 */
const zlib = require('zlib');

/**
 * Prepare one entry. Deflated unless that came out bigger, which happens on the
 * very short XML parts.
 */
function entry(name, content) {
  const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  const deflated = zlib.deflateRawSync(data, { level: 9 });
  const store = deflated.length >= data.length;
  return {
    name,
    method: store ? 0 : 8,
    crc: zlib.crc32(data),
    raw: data.length,
    body: store ? data : deflated,
  };
}

/**
 * Pack entries into a ZIP archive.
 *
 * Timestamps are pinned to 1980-01-01 -- the epoch of the DOS date field the
 * format uses -- so that running the generator twice over unchanged input gives
 * a byte-identical file, and a rebuild is not a diff. Same reasoning as
 * lib/write.js holding JSON timestamps steady.
 */
function zip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');

    // Local file header: 30 bytes, then the name, then the data.
    //   0 sig | 4 verNeeded | 6 flags | 8 method | 10 time | 12 date
    //   | 14 crc32 (4) | 18 compSize (4) | 22 rawSize (4) | 26 nameLen | 28 extraLen
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(e.method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x0021, 12);
    local.writeUInt32LE(e.crc, 14);
    local.writeUInt32LE(e.body.length, 18);
    local.writeUInt32LE(e.raw, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name, e.body);

    // Central directory header: 46 bytes, then the name.
    //   0 sig | 4 verMadeBy | 6 verNeeded | 8 flags | 10 method | 12 time
    //   | 14 date | 16 crc32 (4) | 20 compSize (4) | 24 rawSize (4)
    //   | 28 nameLen | 30 extraLen | 32 commentLen | 34 diskStart
    //   | 36 internalAttrs | 38 externalAttrs (4) | 42 localHeaderOffset (4)
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(e.method, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0x0021, 14);
    cd.writeUInt32LE(e.crc, 16);
    cd.writeUInt32LE(e.body.length, 20);
    cd.writeUInt32LE(e.raw, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, name);

    offset += local.length + name.length + e.body.length;
  }

  const cdBuf = Buffer.concat(central);

  // End of central directory: 22 bytes.
  //   0 sig | 4 disk | 6 cdDisk | 8 entriesHere | 10 entriesTotal
  //   | 12 cdSize (4) | 16 cdOffset (4) | 20 commentLen
  //
  // The offset goes at 16. Writing it at 14 -- which is where it lands if you
  // simply keep adding field widths and lose count -- overwrites the top half of
  // cdSize, and the first version of this did exactly that: the directory then
  // claimed to be 320 MB long and no reader would open the file.
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, cdBuf, end]);
}

module.exports = { entry, zip };
