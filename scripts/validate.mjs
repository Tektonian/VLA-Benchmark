import { loadRecords, relativePath, validateRecord } from './lib.mjs';

const loaded = await loadRecords();
const errors = [];

for (const { file, record } of loaded) {
  errors.push(...validateRecord(record, relativePath(file)));
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log(`Validated ${loaded.length} records.`);

