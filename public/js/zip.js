// Minimal ZIP reader. Reads only the central directory and the entries that
// `want(path)` accepts, using File.slice, so a multi-gigabyte Instagram
// export is never loaded into memory. Supports stored and deflated entries
// and ZIP64 offsets.

const SIG_EOCD = 0x06054b50;
const SIG_EOCD64_LOCATOR = 0x07064b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

const view = async (file, start, end) => new DataView(await file.slice(start, end).arrayBuffer());

export async function readZip(file, want) {
  const tailStart = Math.max(0, file.size - 65557);
  const tail = await view(file, tailStart, file.size);
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a readable ZIP file.');

  let cdSize = tail.getUint32(eocd + 12, true);
  let cdOffset = tail.getUint32(eocd + 16, true);
  const locator = eocd - 20;
  if (locator >= 0 && tail.getUint32(locator, true) === SIG_EOCD64_LOCATOR) {
    const at = Number(tail.getBigUint64(locator + 8, true));
    const big = await view(file, at, at + 56);
    if (big.getUint32(0, true) === SIG_EOCD64) {
      cdSize = Number(big.getBigUint64(40, true));
      cdOffset = Number(big.getBigUint64(48, true));
    }
  }

  const cd = await view(file, cdOffset, cdOffset + cdSize);
  const decoder = new TextDecoder('utf-8');
  const wanted = [];
  let p = 0;
  while (p + 46 <= cd.byteLength && cd.getUint32(p, true) === SIG_CENTRAL) {
    const method = cd.getUint16(p + 10, true);
    let compressed = cd.getUint32(p + 20, true);
    let size = cd.getUint32(p + 24, true);
    const nameLength = cd.getUint16(p + 28, true);
    const extraLength = cd.getUint16(p + 30, true);
    const commentLength = cd.getUint16(p + 32, true);
    let offset = cd.getUint32(p + 42, true);
    const name = decoder.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLength));

    // ZIP64 extended information: only the fields that overflowed are present.
    let e = p + 46 + nameLength;
    const extraEnd = e + extraLength;
    while (e + 4 <= extraEnd) {
      const id = cd.getUint16(e, true);
      const length = cd.getUint16(e + 2, true);
      if (id === 0x0001) {
        let q = e + 4;
        if (size === 0xffffffff) { size = Number(cd.getBigUint64(q, true)); q += 8; }
        if (compressed === 0xffffffff) { compressed = Number(cd.getBigUint64(q, true)); q += 8; }
        if (offset === 0xffffffff) { offset = Number(cd.getBigUint64(q, true)); }
      }
      e += 4 + length;
    }

    if (!name.endsWith('/') && want(name)) wanted.push({ name, method, compressed, offset });
    p += 46 + nameLength + extraLength + commentLength;
  }

  const out = [];
  for (const entry of wanted) {
    const local = await view(file, entry.offset, entry.offset + 30);
    if (local.getUint32(0, true) !== SIG_LOCAL) throw new Error(`Corrupt ZIP entry: ${entry.name}`);
    const start = entry.offset + 30 + local.getUint16(26, true) + local.getUint16(28, true);
    const blob = file.slice(start, start + entry.compressed);
    let text;
    if (entry.method === 0) {
      text = await blob.text();
    } else if (entry.method === 8) {
      if (typeof DecompressionStream === 'undefined') {
        throw new Error('This browser cannot unpack ZIP files. Unzip it first and import the saved_*.html files.');
      }
      text = await new Response(blob.stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
    } else {
      throw new Error(`Unsupported ZIP compression in ${entry.name}. Unzip it first.`);
    }
    out.push({ name: entry.name, text });
  }
  return out;
}
