#!/usr/bin/env node
/**
 * The release pipeline's SemVer rule (issue #59): commit subjects since the
 * last `v*` tag decide the bump — any `feat`-prefixed subject ⇒ minor,
 * everything else (fix/chore/docs/merge commits) ⇒ patch. Parsing and version
 * arithmetic delegate to the `semver` package (owner decision 2026-11-26);
 * the CLI computes the next version from the current repo so
 * `.github/workflows/docker.yml` carries orchestration only, never policy.
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import semver from 'semver';

/** `feat` must stand alone: feat(#31) and feat: bump, but "featured" doesn't. */
const isFeature = (subject) => /^feat\b/i.test(String(subject).trim());

/**
 * Core rule: subjects since `lastTag` decide the next version via semver.inc
 * — semver handles the `v` prefix, prerelease suffixes (an rc releases as its
 * own version) and invalid tags; null/absent `lastTag` starts from a 1.0.0
 * baseline. Ties to AGENTS.md's SemVer convention.
 */
export function nextVersion(lastTag, subjects) {
  const normalized =
    lastTag === null || lastTag === undefined ? null : semver.valid(String(lastTag).trim());
  return semver.inc(normalized ?? '1.0.0', subjects.some(isFeature) ? 'minor' : 'patch');
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
