import { loadRecords, relativePath, validateRecord, writeDist } from './lib.mjs';

const loaded = await loadRecords();
const errors = [];

for (const { file, record } of loaded) {
  errors.push(...validateRecord(record, relativePath(file)));
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

await writeDist(loaded.map(({ record }) => record));

console.log(`Built ${loaded.length} records into 100-record chunks.`);

