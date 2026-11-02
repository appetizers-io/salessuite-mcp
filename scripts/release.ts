/**
 * Starts the Release workflow on main and follows it in the terminal.
 *
 *   npm run release              # bump from the Conventional Commit titles since the last tag
 *   npm run release -- patch     # or minor / major: force the bump (e.g. dependency-only releases)
 *
 * The publish job waits for approval of the `release` environment; approve it on the run page that is printed.
 * Requires the GitHub CLI (`gh`), logged in with access to the repository.
 */
import { execFileSync } from 'node:child_process';

const BUMPS = ['auto', 'patch', 'minor', 'major'] as const;
const WORKFLOW = 'release.yml';

const bump = process.argv[2] ?? 'auto';
if (!(BUMPS as readonly string[]).includes(bump)) {
  console.error(`Unknown bump "${bump}". Use one of: ${BUMPS.join(', ')}.`);
  process.exit(1);
}

const gh = (args: string[]): string => execFileSync('gh', args, { encoding: 'utf8' }).trim();

const startedAt = new Date();
gh(['workflow', 'run', WORKFLOW, '--ref', 'main', '-f', `bump=${bump}`]);
console.log(`Started the Release workflow on main (bump: ${bump}).`);

// `gh workflow run` does not return the run; find the one created just now.
let run: { databaseId: number; url: string } | undefined;
for (let attempt = 0; attempt < 20 && !run; attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const runs = JSON.parse(
    gh(['run', 'list', '--workflow', WORKFLOW, '--event', 'workflow_dispatch', '--limit', '5', '--json', 'databaseId,url,createdAt']),
  ) as Array<{ databaseId: number; url: string; createdAt: string }>;
  run = runs.find((r) => new Date(r.createdAt).getTime() >= startedAt.getTime() - 5000);
}
if (!run) {
  console.error('Could not find the started run; check the Actions tab.');
  process.exit(1);
}

console.log(`Run: ${run.url}`);
console.log('The publish job waits for approval of the "release" environment on that page.\n');
execFileSync('gh', ['run', 'watch', String(run.databaseId), '--exit-status', '--interval', '10'], { stdio: 'inherit' });
