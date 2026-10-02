import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { assetUrl } from '../src/web/assets.js';
import { makeApp, type TestApp } from './helpers/app.js';

let t: TestApp;
beforeEach(async () => {
  t = await makeApp();
});

describe('asset cache-busting', () => {
  it('derives the version from the file content', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chromajev-assets-'));
    fs.writeFileSync(path.join(dir, 'a.css'), 'body{color:red}');
    const v1 = assetUrl('a.css', dir);
    expect(v1).toMatch(/^\/assets\/a\.css\?v=[0-9a-f]{10}$/);
    expect(assetUrl('a.css', dir)).toBe(v1);
    fs.writeFileSync(path.join(dir, 'a.css'), 'body{color:blue}');
    expect(assetUrl('a.css', dir)).not.toBe(v1);
    expect(assetUrl('missing.css', dir)).toBe('/assets/missing.css');
  });

  it('links every page to versioned assets', async () => {
    const text = (await request(t.app).get('/login')).text;
    expect(text).toMatch(/href="\/assets\/app\.css\?v=[0-9a-f]{10}"/);
    expect(text).toMatch(/src="\/assets\/app\.js\?v=[0-9a-f]{10}"/);
    expect(text).toMatch(/href="\/assets\/favicon\.svg\?v=[0-9a-f]{10}"/);
  });

  it('caches versioned assets for a year and makes unversioned requests revalidate', async () => {
    const url = /href="(\/assets\/app\.css\?v=[0-9a-f]{10})"/.exec((await request(t.app).get('/login')).text)![1];
    const versioned = await request(t.app).get(url);
    expect(versioned.status).toBe(200);
    expect(versioned.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    const bare = await request(t.app).get('/assets/app.css');
    expect(bare.headers['cache-control']).toBe('no-cache');
    expect(bare.headers.etag).toBeTruthy();
  });

  it('never lets a page be reused without asking the server', async () => {
    expect((await request(t.app).get('/login')).headers['cache-control']).toBe('private, no-cache');
  });
});
