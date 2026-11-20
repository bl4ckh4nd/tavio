// General Sans is licensed under the ITF Free Font License: self-hosting is allowed, passing the files on through a
// repository is not. So each install fetches its own copy from Fontshare into public/fonts (gitignored). Without the
// files the UI falls back to the system stack in src/styles/tokens.css, so a failed download never fails a build.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const KIT = 'https://api.fontshare.com/v2/fonts/download/general-sans';
const FILES = ['GeneralSans-Regular.woff2', 'GeneralSans-Medium.woff2', 'GeneralSans-Semibold.woff2'];
const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'fonts');

const readZipEntries = (zip) => {
  let end = zip.length - 22;
  while (end >= 0 && zip.readUInt32LE(end) !== 0x06054b50) end -= 1;
  if (end < 0) throw new Error('not a zip archive');

  const entries = new Map();
  let offset = zip.readUInt32LE(end + 16);
  for (let i = zip.readUInt16LE(end + 10); i > 0; i -= 1) {
    const method = zip.readUInt16LE(offset + 10);
    const size = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const local = zip.readUInt32LE(offset + 42);
    const name = zip.toString('utf8', offset + 46, offset + 46 + nameLength);
    entries.set(name.split('/').pop(), () => {
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + size);
      return method === 8 ? inflateRawSync(data) : data;
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
};

const missing = FILES.filter((file) => !existsSync(join(target, file)));
if (missing.length > 0) {
  try {
    const response = await fetch(KIT, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`Fontshare answered ${response.status}`);
    const entries = readZipEntries(Buffer.from(await response.arrayBuffer()));
    mkdirSync(target, { recursive: true });
    for (const file of missing) {
      const read = entries.get(file);
      if (!read) throw new Error(`${file} is not in the kit`);
      writeFileSync(join(target, file), read());
    }
    console.log(`Fetched ${missing.length} General Sans files from Fontshare.`);
  } catch (error) {
    const message = `General Sans could not be fetched (${error.message}); the UI falls back to the system font.`;
    console.warn(process.env.GITHUB_ACTIONS ? `::warning::${message}` : message);
  }
}
