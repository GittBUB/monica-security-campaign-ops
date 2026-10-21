const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workflowsDir = path.join(__dirname, '../workflows');
const workflows = fs.readdirSync(workflowsDir)
  .filter(file => /^monica-campaign-.*\.lock\.yml$/.test(file));

for (const file of workflows) {
  const workflow = fs.readFileSync(path.join(workflowsDir, file), 'utf8');

  test(`${file}: setup actions remain available for post-job cleanup after repository checkout`, () => {
    const setups = [...workflow.matchAll(/^\s+uses: (.+\/actions\/setup(?:@\S+)?)$/gm)];
    assert.ok(setups.length > 0, 'workflow must contain setup actions');
    for (const [, action] of setups) {
      assert.match(action, /^github\/gh-aw\/actions\/setup@[a-f0-9]{40}$/);
    }
    assert.doesNotMatch(workflow, /^\s+repository: github\/gh-aw$/m);
  });

  test(`${file}: lock file matches the source frontmatter`, () => {
    const source = fs.readFileSync(
      path.join(workflowsDir, file.replace(/\.lock\.yml$/, '.md')),
      'utf8',
    );
    const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    assert.ok(frontmatter, 'workflow must contain frontmatter');
    const metadata = JSON.parse(workflow.match(/^# gh-aw-metadata: (.+)$/m)[1]);
    assert.equal(metadata.schema_version, 'v4');
    const hash = createHash('sha256')
      .update(JSON.stringify({ 'frontmatter-text': frontmatter[1].trim() }))
      .digest('hex');
    assert.equal(metadata.frontmatter_hash, hash, `Run gh aw compile ${file.replace(/\.lock\.yml$/, '')}`);
  });
}
