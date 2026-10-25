import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.MOCK_FILE = path.join(here, 'fixture.json');
process.env.DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'mpw-'));
process.env.PORT = '0';
const { start, normalize } = await import('../server.js');

let server, base;
before(async () => {
  server = await start();
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

test('normalize flattens lands and the top-level rides array', () => {
  const rides = normalize({
    lands: [{ name: 'A', rides: [{ id: 1, name: 'X', is_open: true, wait_time: 5, last_updated: 't' }] }],
    rides: [{ id: 2, name: 'Y', is_open: false, wait_time: 0, last_updated: 't' }],
  });
  assert.deepEqual(rides, [
    { id: '1', name: 'X', land: 'A', isOpen: true, wait: 5, lastUpdated: 't' },
    { id: '2', name: 'Y', land: null, isOpen: false, wait: 0, lastUpdated: 't' },
  ]);
});

test('/api/waits returns normalized rides with history', async () => {
  const body = await (await fetch(`${base}/api/waits`)).json();
  assert.equal(body.park.id, '310');
  assert.equal(body.stale, false);
  assert.equal(body.rides.length, 11);
  const bandit = body.rides.find((r) => r.name === 'The Bandit');
  assert.equal(bandit.wait, 60);
  assert.equal(bandit.history.length, 1);
  const closed = body.rides.find((r) => r.name === 'Iron Claw');
  assert.equal(closed.history[0][1], null, 'closed rides record null, not 0');
});

test('history is persisted to DATA_DIR', async () => {
  const saved = JSON.parse(await fs.readFile(path.join(process.env.DATA_DIR, 'history.json'), 'utf8'));
  assert.ok(saved.rides['102']);
});

test('serves the frontend and blocks path traversal', async () => {
  const index = await fetch(`${base}/`);
  assert.equal(index.status, 200);
  assert.match(await index.text(), /Movie Park Waits/);
  const evil = await fetch(`${base}/..%2fserver.js`);
  assert.notEqual(evil.status, 200);
});
