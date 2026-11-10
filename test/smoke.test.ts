import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('project scaffold', () => {
  it('is the bum project', () => {
    const pkg = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf-8'),
    ) as { name: string };
    expect(pkg.name).toBe('bum');
  });
});
