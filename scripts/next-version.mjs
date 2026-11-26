#!/usr/bin/env node
/**
 * The release pipeline's SemVer rule (issue #59): commit subjects since the
 * last `v*` tag decide the bump — any `feat`-prefixed subject ⇒ minor,
 * everything else (fix/chore/docs/merge commits) ⇒ patch. The CLI computes
 * the next version from the current repo so `.github/workflows/docker.yml`
 * carries orchestration only, never policy.
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** "v1.2.3" / "1.2.3" → { major, minor, patch }; anything else → null. */
export function parseVersion(tag) {
  if (tag === null || tag === undefined) return null;
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(tag).trim());
  if (match === null) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/** `feat` must stand alone: feat(#31) and feat: bump, but "featured" doesn't. */
const isFeature = (subject) => /^feat\b/i.test(String(subject).trim());

/**
 * Core rule: subjects since `lastTag` (null = no releases yet → a 1.0.0
 * baseline) decide the next version. Ties to AGENTS.md's SemVer convention.
 */
export function nextVersion(lastTag, subjects) {
  const base = parseVersion(lastTag) ?? { major: 1, minor: 0, patch: 0 };
  if (subjects.some(isFeature)) return `${base.major}.${base.minor + 1}.0`;
  return `${base.major}.${base.minor}.${base.patch + 1}`;
}

function lastVersionTag() {
  const raw = execFileSync('git', ['tag', '--list', 'v*', '--sort=-v:refname'], {
    encoding: 'utf8',
  }).trim();
  return raw === '' ? null : raw.split('\n')[0];
}

function subjectsSince(tag) {
  const args = tag === null ? ['log', '--format=%s'] : ['log', `${tag}..HEAD`, '--format=%s'];
  return execFileSync('git', args, { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

const isMainModule = () => {
  try {
    return import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? '')).href;
  } catch {
    return false;
  }
};

if (isMainModule()) {
  const lastTag = lastVersionTag();
  console.log(nextVersion(lastTag, subjectsSince(lastTag)));
}
