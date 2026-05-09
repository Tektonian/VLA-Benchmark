import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const RECORDS_DIR = new URL('../records/', import.meta.url);
export const DIST_DIR = new URL('../dist/', import.meta.url);
export const CHUNK_DIR = new URL('../dist/vla-benchmark/', import.meta.url);
export const MANIFEST_PATH = new URL('../dist/vla-benchmark.manifest.json', import.meta.url);
export const TOP3_HISTORY_PATH = new URL('../dist/vla-benchmark.top3-history.json', import.meta.url);
export const CHUNK_SIZE = 100;
export const TOP_RANK_LIMIT = 3;
export const MIN_RANK_BENCHMARK_COUNT = 5;
export const TOP_RANK_POINTS = [5, 4, 3, 2, 1];

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

  const previousTopRankHistory = await readTopRankHistory();
  const topRankHistory = buildTopRankHistory(records, previousTopRankHistory);
  const topRankHistoryJson = `${JSON.stringify(topRankHistory, null, 2)}\n`;

  const manifest = {
    schemaVersion: 1,
    chunkSize: CHUNK_SIZE,
    totalRecords: records.length,
    totalChunks: chunks.length,
    topRankHistory: {
      path: 'vla-benchmark.top3-history.json',
      topRankLimit: topRankHistory.topRankLimit,
      scoreMethod: topRankHistory.scoreMethod,
      historyMode: topRankHistory.historyMode,
      minRankBenchmarkCount: topRankHistory.minRankBenchmarkCount,
      historyEventCount: topRankHistory.history.length,
      finalTopCount: topRankHistory.finalTop.length,
      sha256: createHash('sha256').update(topRankHistoryJson).digest('hex'),
    },
    chunks,
  };

  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(TOP3_HISTORY_PATH, topRankHistoryJson);
}

async function readTopRankHistory() {
  try {
    return JSON.parse(await readFile(TOP3_HISTORY_PATH, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`${relativePath(TOP3_HISTORY_PATH.pathname)} is not valid JSON: ${error.message}`);
  }
}

export function buildTopRankHistory(records, previousHistoryOrLimit = null, limit = TOP_RANK_LIMIT) {
  let previousHistory = previousHistoryOrLimit;

  if (typeof previousHistoryOrLimit === 'number') {
    limit = previousHistoryOrLimit;
    previousHistory = null;
  }

  const rankedRecords = rankRecords(records);
  const finalTop = rankedRecords.filter((entry) => entry.rankScore !== null).slice(0, limit);
  const hasCompatibleHistory = isCompatibleTopRankHistory(previousHistory, limit);
  const history = hasCompatibleHistory ? [...previousHistory.history] : [];
  const previousTop = hasCompatibleHistory ? previousHistory.finalTop : finalTop;
  const previousTopKey = getTopKey(previousTop);
  const finalTopKey = getTopKey(finalTop);

  if (hasCompatibleHistory && previousTopKey !== finalTopKey) {
    history.push({
      changeType: 'top-rank-changed',
      previousTotalRecords: previousHistory.totalRecords,
      totalRecords: records.length,
      addedRecords: records
        .slice(previousHistory.totalRecords)
        .map((record, index) => createAddedRecordEntry(record, previousHistory.totalRecords + index)),
      previousTop,
      top: finalTop,
      changes: describeRankChanges(previousTop, finalTop),
    });
  }

  return {
    schemaVersion: 1,
    topRankLimit: limit,
    scoreDescription:
      'Matches the vla-leaderboard overall rank score: for each benchmark label, eligible models receive 5/4/3/2/1 points for ranks 1-5 by best overall score, then points are averaged over ranked benchmark count.',
    minRankBenchmarkCount: MIN_RANK_BENCHMARK_COUNT,
    topRankPoints: TOP_RANK_POINTS,
    totalRecords: records.length,
    finalTop,
    history,
  };
}

function isCompatibleTopRankHistory(history, limit) {
  return (
    history &&
    history.schemaVersion === 1 &&
    history.topRankLimit === limit &&
    Array.isArray(history.finalTop) &&
    Array.isArray(history.history) &&
    Number.isInteger(history.totalRecords)
  );
}

function rankRecords(records) {
  const rankScoreByRecord = getRankScoreByRecord(records);
  const originalIndexByRecord = new Map(records.map((record, index) => [record, index]));

  return [...records]
    .sort((left, right) => {
      const leftScore = rankScoreByRecord.get(left);
      const rightScore = rankScoreByRecord.get(right);
      const leftRankScore = leftScore?.rankScore ?? null;
      const rightRankScore = rightScore?.rankScore ?? null;
      const leftEligible = leftRankScore !== null;
      const rightEligible = rightRankScore !== null;

      if (leftEligible !== rightEligible) return Number(rightEligible) - Number(leftEligible);

      const performanceGap = (rightRankScore ?? 0) - (leftRankScore ?? 0);
      if (performanceGap !== 0) return performanceGap;

      const benchmarkCountGap = right.benchmarks.length - left.benchmarks.length;
      if (benchmarkCountGap !== 0) return benchmarkCountGap;

      return originalIndexByRecord.get(left) - originalIndexByRecord.get(right);
    })
    .map((record, index) => createModelRankEntry(record, rankScoreByRecord.get(record), index));
}

function getRankScoreByRecord(records) {
  const scoreByRecord = new Map();
  const benchmarkLabels = Array.from(
    new Set(
      records.flatMap((record) =>
        record.benchmarks
          .filter((benchmark) => benchmark.overall !== undefined)
          .map((benchmark) => benchmark.label),
      ),
    ),
  );

  records.forEach((record) => {
    scoreByRecord.set(record, { points: 0, rankedBenchmarkCount: 0 });
  });

  benchmarkLabels.forEach((label) => {
    const entries = records
      .filter((record) => record.benchmarks.length >= MIN_RANK_BENCHMARK_COUNT)
      .map((record) => {
        const bestScore = record.benchmarks
          .filter((benchmark) => benchmark.label === label && benchmark.overall !== undefined)
          .map((benchmark) => benchmark.overall)
          .sort((left, right) => right - left)[0];

        return bestScore === undefined ? null : { record, score: bestScore };
      })
      .filter((entry) => entry !== null)
      .sort((left, right) => right.score - left.score);

    entries.forEach(({ record }, index) => {
      if (index >= TOP_RANK_POINTS.length) return;

      const current = scoreByRecord.get(record);
      if (!current) return;

      current.points += TOP_RANK_POINTS[index];
      current.rankedBenchmarkCount += 1;
    });
  });

  return new Map(
    Array.from(scoreByRecord, ([record, score]) => {
      const isUnranked =
        record.benchmarks.length < MIN_RANK_BENCHMARK_COUNT || score.rankedBenchmarkCount === 0;

      return [
        record,
        {
          ...score,
          rankScore: isUnranked ? null : score.points / score.rankedBenchmarkCount,
        },
      ];
    }),
  );
}

function createModelRankEntry(record, score, index) {
  return {
    rank: index + 1,
    model: record.model,
    paperTitle: record.paperTitle,
    paperUrl: record.paperUrl,
    arxivId: record.arxivId,
    publishedAt: record.publishedAt,
    organization: record.organization,
    flag: record.flag,
    benchmarkCount: record.benchmarks.length,
    rankedBenchmarkCount: score?.rankedBenchmarkCount ?? 0,
    points: score?.points ?? 0,
    rankScore: score?.rankScore ?? null,
  };
}

function createAddedRecordEntry(record, recordIndex) {
  return {
    recordIndex,
    model: record.model,
    paperTitle: record.paperTitle,
    paperUrl: record.paperUrl,
    arxivId: record.arxivId,
    publishedAt: record.publishedAt,
    organization: record.organization,
    flag: record.flag,
    benchmarkCount: record.benchmarks.length,
  };
}

function getTopKey(top) {
  return top
    .map((item) => `${item.rank}:${getRankEntryKey(item)}:${item.rankScore}:${item.benchmarkCount}`)
    .join('|');
}

function describeRankChanges(previousTop, nextTop) {
  const previousByKey = new Map(previousTop.map((entry) => [getRankEntryKey(entry), entry]));
  const nextByKey = new Map(nextTop.map((entry) => [getRankEntryKey(entry), entry]));
  const changes = [];

  for (const next of nextTop) {
    const previous = previousByKey.get(getRankEntryKey(next));

    if (!previous) {
      changes.push({
        type: 'entered',
        model: next.model,
        fromRank: null,
        toRank: next.rank,
        rankScore: next.rankScore,
      });
      continue;
    }

    if (previous.rank !== next.rank || previous.rankScore !== next.rankScore) {
      changes.push({
        type: previous.rank === next.rank ? 'score-changed' : 'rank-changed',
        model: next.model,
        fromRank: previous.rank,
        toRank: next.rank,
        previousRankScore: previous.rankScore,
        rankScore: next.rankScore,
      });
    }
  }

  for (const previous of previousTop) {
    if (nextByKey.has(getRankEntryKey(previous))) continue;

    changes.push({
      type: 'exited',
      model: previous.model,
      fromRank: previous.rank,
      toRank: null,
      previousRankScore: previous.rankScore,
    });
  }

  return changes;
}

function getRankEntryKey(entry) {
  return getRecordKey(entry);
}

function getRecordKey(record) {
  return `${record.model.trim().toLowerCase()}|${record.arxivId.trim().toLowerCase()}`;
}

export function relativePath(file) {
  return path.relative(new URL('..', import.meta.url).pathname, file);
}
