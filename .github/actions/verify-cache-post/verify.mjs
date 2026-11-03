import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

if (!process.env.STATE_verifyPost) {
  fs.appendFileSync(process.env.GITHUB_STATE, 'verifyPost=true\n');
} else {
  const prefix = `clean-caller-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}-`;
  const records = fs.readdirSync(process.env.CI_METRICS_DIR)
    .filter(name => name.startsWith('cache-') && name.endsWith('.json'))
    .map(name => JSON.parse(fs.readFileSync(path.join(process.env.CI_METRICS_DIR, name), 'utf8')))
    .filter(record => record.key.startsWith(prefix));
  assert.equal(records.length, 2, 'Each invocation must emit its own metrics record');
  for (const suffix of ['first', 'second']) {
    const record = records.find(item => item.key === `${prefix}${suffix}`);
    assert.ok(record, `Missing metrics for ${suffix}`);
    assert.equal(record.backend, 's3');
    assert.ok(record.timestamp_restored, 'Restore measurement must complete');
    assert.ok(record.timestamp_at_end, 'Post measurement must complete');
    assert.equal(record.saved, true, 'Unique keys must use the cache save path');
    assert.equal(typeof record.size_bytes_restored, 'number');
    assert.ok(record.size_bytes_at_end > 0, 'Post measurement must see the populated cache');
  }
  console.log('Both cache invocations completed main and post metrics');
}
