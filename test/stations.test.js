import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STATIONS, STATION_BY_ID, classifyShell, classifyTool, patchFiles, shortPath, splitShellSegments, truncate,
} from '../shared/stations.js';

test('catalog has unique ids and every station is described', () => {
  const ids = STATIONS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const s of STATIONS) {
    assert.ok(s.kitchen && s.sdlc && s.verb && s.examples, s.id);
    assert.equal(STATION_BY_ID[s.id], s);
  }
});

const SHELL_CASES = [
  // ship
  ['git push origin main', 'ship'],
  ['git add -A && git commit -m "wip" && git push', 'ship'],
  ['gh pr create --fill --draft', 'ship'],
  ['npm publish', 'ship'],
  ['docker push ghcr.io/me/app:1', 'ship'],
  ['kubectl apply -f k8s/', 'ship'],
  // commit
  ['git commit -m "Add station catalog"', 'commit'],
  ['git add . ; git commit -m "x"', 'commit'],
  ['git stash', 'commit'],
  ['git -C C:\\repo rebase main', 'commit'],
  // test
  ['npm test', 'test'],
  ['npm run test:unit -- --watch=false', 'test'],
  ['pnpm -C packages/app test', 'test'],
  ['yarn test', 'test'],
  ['node --test "test/*.test.js"', 'test'],
  ['npx vitest run', 'test'],
  ['npx --yes playwright test', 'test'],
  ['python -m pytest -q', 'test'],
  ['pytest tests/', 'test'],
  ['python manage.py test', 'test'],
  ['go test ./...', 'test'],
  ['cargo test', 'test'],
  ['dotnet test MySln.sln', 'test'],
  ['./gradlew test', 'test'],
  ['mvn -q verify', 'test'],
  ['make test', 'test'],
  ['npm install && npm test', 'test'],
  ['npm run build && npm test', 'test'],
  ['Invoke-Pester ./tests', 'test'],
  ['bash -c "npm test"', 'test'],
  ['cmd /c npm test', 'test'],
  ['$out = npm test', 'test'],
  // build
  ['npm run build', 'build'],
  ['npx tsc --noEmit', 'build'],
  ['tsc -p .', 'build'],
  ['dotnet build -c Release', 'build'],
  ['cargo build --release', 'build'],
  ['go build ./cmd/app', 'build'],
  ['make', 'build'],
  ['mvn clean install', 'build'],
  ['docker build -t app .', 'build'],
  ['docker compose build', 'build'],
  ['npx esbuild entry.js --bundle', 'build'],
  ['./build.ps1 -Configuration Release', 'build'],
  ['msbuild App.sln /p:Configuration=Release', 'build'],
  // lint
  ['npx eslint . --fix', 'lint'],
  ['npm run lint', 'lint'],
  ['npm run format', 'lint'],
  ['prettier --write .', 'lint'],
  ['ruff check .', 'lint'],
  ['python -m black .', 'lint'],
  ['cargo clippy -- -D warnings', 'lint'],
  ['dotnet format', 'lint'],
  ['go vet ./...', 'lint'],
  // install
  ['npm install', 'install'],
  ['npm ci', 'install'],
  ['npm i -D vitest', 'install'],
  ['yarn', 'install'],
  ['pnpm add three', 'install'],
  ['pip install -r requirements.txt', 'install'],
  ['python -m pip install requests', 'install'],
  ['uv sync', 'install'],
  ['dotnet restore', 'install'],
  ['go mod tidy', 'install'],
  ['winget install Git.Git', 'install'],
  ['npx playwright install chromium', 'install'],
  // trash
  ['rm -rf dist', 'trash'],
  ['Remove-Item -Recurse -Force node_modules', 'trash'],
  ['git reset --hard HEAD~1', 'trash'],
  ['git clean -fdx', 'trash'],
  ['git checkout -- src/app.js', 'trash'],
  ['git restore src/app.js', 'trash'],
  // research
  ['curl -s https://api.github.com/repos/x/y', 'research'],
  ['Invoke-WebRequest -Uri https://example.com', 'research'],
  ['gh api repos/x/y/pulls', 'research'],
  ['gh pr view 12 --json files', 'research'],
  ['gh run watch', 'research'],
  ['git fetch origin', 'research'],
  ['git pull --rebase', 'research'],
  // search
  ['rg "TODO" src', 'search'],
  ['grep -rn foo .', 'search'],
  ['Get-ChildItem -Recurse | Select-String -Pattern "foo"', 'search'],
  ['git grep -n classifyTool', 'search'],
  // read
  ['git status', 'read'],
  ['git --no-pager log --oneline -n 20', 'read'],
  ['git diff HEAD~1', 'read'],
  ['cat README.md', 'read'],
  ['Get-Content .\\package.json', 'read'],
  ['Get-ChildItem -Force', 'read'],
  ['ls -la', 'read'],
  // shell (prep)
  ['npm run dev', 'shell'],
  ['npm start', 'shell'],
  ['node server/index.js --port 7425', 'shell'],
  ['echo hello', 'shell'],
  ['cd src', 'shell'],
  ['docker compose up -d', 'shell'],
  ['dotnet run --project src/Api', 'shell'],
  ['git checkout -b feature/x', 'shell'],
  ['', 'shell'],
  // plan
  ['terraform plan', 'plan'],
];

for (const [cmd, expected] of SHELL_CASES) {
  test(`shell: ${cmd || '(empty)'} → ${expected}`, () => {
    assert.equal(classifyShell(cmd), expected);
  });
}

test('shell description is used as a fallback only', () => {
  assert.equal(classifyShell('./ci.ps1', 'Run unit tests'), 'test');
  assert.equal(classifyShell('node scripts/x.js', 'Build the bundle'), 'build');
  assert.equal(classifyShell('node scripts/x.js', 'Install dependencies with npm'), 'install');
  assert.equal(classifyShell('git status', 'Run tests'), 'read'); // a recognised command wins
  assert.equal(classifyShell('echo hi', 'Say hello'), 'shell');
});

test('splitShellSegments splits on common separators', () => {
  assert.deepEqual(splitShellSegments('a && b; c | d || e\nf'), ['a', 'b', 'c', 'd', 'e', 'f']);
});

const TOOL_CASES = [
  ['view', { path: 'C:\\repo\\server\\index.js' }, 'read', 'Reading server/index.js'],
  ['grep', { pattern: 'classifyTool' }, 'search', 'Searching “classifyTool”'],
  ['rg', { pattern: 'foo' }, 'search'],
  ['glob', { pattern: '**/*.js' }, 'search', 'Finding **/*.js'],
  ['edit', { path: '/repo/src/app.js', old_str: 'a', new_str: 'b' }, 'code', 'Chopping app.js'],
  ['create', { path: '/repo/src/new.js', file_text: '' }, 'code', 'Creating new.js'],
  ['web_fetch', { url: 'https://www.example.com/docs' }, 'research', 'Fetching example.com'],
  ['web_search', { query: 'three.js shadows' }, 'research'],
  ['github-mcp-server-get_file_contents', {}, 'research', 'github: get file contents'],
  ['github-mcp-server-create_pull_request', {}, 'ship'],
  ['slack-slack_search_public', {}, 'research'],
  ['workiq-ask', {}, 'research', 'workiq: ask'],
  ['ask_user', { question: 'Which?' }, 'ask', 'Asking you a question'],
  ['task', { description: 'Explore auth module', agent_type: 'explore' }, 'plan', 'Briefing a sous-chef: Explore auth module'],
  ['sql', { description: 'Create build todos', query: 'INSERT INTO todos' }, 'plan', 'Create build todos'],
  ['skill', { skill: 'pdf' }, 'plan'],
  ['task_complete', { summary: 'done' }, 'ship', 'Serving the order!'],
  ['create_pull_request', { title: 'x' }, 'ship'],
  ['computer-use-click', {}, 'test'],
  ['open_canvas', {}, 'test'],
  ['powershell', { command: 'npm test', description: 'Run tests' }, 'test', 'Run tests'],
  ['powershell', { command: 'git push' }, 'ship', 'git push'],
  ['bash', { command: 'rm -rf build' }, 'trash'],
  ['read_powershell', { shellId: '3', delay: 10 }, 'shell', 'Checking the pot'],
  ['some_new_tool', {}, 'shell', 'some new tool'],
];

for (const [tool, args, station, label] of TOOL_CASES) {
  test(`tool: ${tool} → ${station}`, () => {
    const r = classifyTool(tool, args);
    assert.equal(r.station, station);
    if (label) assert.equal(r.label, label);
  });
}

test('apply_patch: parses files, delete-only patches go to the bin', () => {
  const patch = '*** Begin Patch\n*** Add File: hello.ps1\n+Write-Host hi\n*** Update File: src/a.js\n@@\n-x\n+y\n*** End Patch';
  assert.deepEqual(patchFiles(patch), [{ op: 'add', path: 'hello.ps1' }, { op: 'update', path: 'src/a.js' }]);
  assert.deepEqual(classifyTool('apply_patch', patch), { station: 'code', label: 'Patching hello.ps1, a.js' });
  assert.deepEqual(classifyTool('apply_patch', { patch }), { station: 'code', label: 'Patching hello.ps1, a.js' });
  const del = '*** Begin Patch\n*** Delete File: old/thing.js\n*** End Patch';
  assert.equal(classifyTool('apply_patch', del).station, 'trash');
});

test('helpers', () => {
  assert.equal(shortPath('C:\\a\\b\\c.js'), 'b/c.js');
  assert.equal(shortPath(''), '');
  assert.equal(truncate('hello world', 6), 'hello…');
  assert.equal(truncate('  spaced\n\ntext ', 50), 'spaced text');
});
