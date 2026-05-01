import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const RECORDS_DIR = new URL('../records/', import.meta.url);
export const DIST_DIR = new URL('../dist/', import.meta.url);
export const CHUNK_DIR = new URL('../dist/vla-benchmark/', import.meta.url);
export const MANIFEST_PATH = new URL('../dist/vla-benchmark.manifest.json', import.meta.url);
export const CHUNK_SIZE = 100;

const REQUIRED_RECORD_FIELDS = [
  'model',
  'paperTitle',
  'paperUrl',
  'arxivId',
  'publishedAt',
  'organization',
  'flag',
  'benchmarks',
];

const REQUIRED_BENCHMARK_FIELDS = ['label', 'query'];

export async function listJsonFiles(dirUrl) {
  const dirPath = dirUrl.pathname;
  const entries = await readdir(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;

    const entryPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listJsonFiles(new URL(`${entryPath}/`, 'file://'))));
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      files.push(entryPath);
    }
  }

  return files.sort(compareRecordFiles);
}

function compareRecordFiles(left, right) {
  const leftIndex = getRecordFileIndex(left);
  const rightIndex = getRecordFileIndex(right);

  if (leftIndex !== rightIndex) return leftIndex - rightIndex;
  return left.localeCompare(right, 'en');
}

function getRecordFileIndex(file) {
  const match = path.basename(file).match(/^(\d+)/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

export async function loadRecords() {
  const files = await listJsonFiles(RECORDS_DIR);
  const records = [];

  for (const file of files) {
    const raw = await readFile(file, 'utf8');
    let record;

    try {
      record = JSON.parse(raw);
    } catch (error) {
      throw new Error(`${relativePath(file)} is not valid JSON: ${error.message}`);
    }

    records.push({ file, record });
  }

  return records;
}

export function validateRecord(record, file = '<record>') {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return [`${file}: record must be an object`];
  }

  const errors = [];

  for (const field of REQUIRED_RECORD_FIELDS) {
    if (!(field in record)) errors.push(`${file}: missing ${field}`);
  }

  for (const [key, value] of Object.entries(record)) {
    if (!REQUIRED_RECORD_FIELDS.includes(key)) errors.push(`${file}: unexpected field ${key}`);
    if (key !== 'benchmarks' && typeof value !== 'string') {
      errors.push(`${file}: ${key} must be a string`);
    }
  }

  if (!Array.isArray(record.benchmarks)) {
    errors.push(`${file}: benchmarks must be an array`);
    return errors;
  }

  record.benchmarks.forEach((benchmark, index) => {
    const prefix = `${file}: benchmarks[${index}]`;

    if (!benchmark || typeof benchmark !== 'object' || Array.isArray(benchmark)) {
      errors.push(`${prefix} must be an object`);
      return;
    }

    for (const field of REQUIRED_BENCHMARK_FIELDS) {
      if (!(field in benchmark)) errors.push(`${prefix}: missing ${field}`);
    }

    for (const [key, value] of Object.entries(benchmark)) {
      if (!['label', 'query', 'overall', 'detail'].includes(key)) {
        errors.push(`${prefix}: unexpected field ${key}`);
      }

      if ((key === 'label' || key === 'query' || key === 'detail') && typeof value !== 'string') {
        errors.push(`${prefix}: ${key} must be a string`);
      }

      if (key === 'overall' && typeof value !== 'number') {
        errors.push(`${prefix}: overall must be a number`);
      }
    }
  });

  return errors;
}

export async function writeDist(records) {
  await rm(CHUNK_DIR, { recursive: true, force: true });
  await mkdir(CHUNK_DIR, { recursive: true });

  const chunks = [];

  for (let index = 0; index < records.length; index += CHUNK_SIZE) {
    const id = String(chunks.length + 1).padStart(4, '0');
    const chunkRecords = records.slice(index, index + CHUNK_SIZE);
    const chunkJson = `${JSON.stringify(chunkRecords, null, 2)}\n`;
    const chunkPath = `vla-benchmark/${id}.json`;

    await writeFile(new URL(chunkPath, DIST_DIR), chunkJson);

    chunks.push({
      id,
      path: chunkPath,
      count: chunkRecords.length,
      startIndex: index,
      endIndex: index + chunkRecords.length - 1,
      sha256: createHash('sha256').update(chunkJson).digest('hex'),
    });
  }

  const manifest = {
    schemaVersion: 1,
    chunkSize: CHUNK_SIZE,
    totalRecords: records.length,
    totalChunks: chunks.length,
    chunks,
  };

  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
}

export function relativePath(file) {
  return path.relative(new URL('..', import.meta.url).pathname, file);
}
