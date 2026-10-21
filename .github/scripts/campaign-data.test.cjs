const assert = require('node:assert/strict');
const test = require('node:test');
const { collectCampaignData, collectAlertOwnerData, hasAlertOwnerWork } = require('./campaign-data.cjs');

function makeGithub({ issues = [], propertiesError } = {}) {
  const calls = [];
  const campaign = {
    number: 7,
    name: 'monica-test',
    state: 'open',
    published_at: '2026-01-01T00:00:00Z',
    alert_stats: { open_count: 1, closed_count: 2, in_progress_count: 0 },
  };
  const github = {
    paginate: async (route, params) => {
      calls.push([route, params]);
      if (route === 'GET /orgs/{org}/campaigns') return [campaign];
      if (route === 'GET /search/issues') return issues;
      if (route === 'GET /repos/{owner}/{repo}/code-scanning/alerts' && params.state === 'open') {
        return [{ number: 12, html_url: 'https://github.com/octodemo/app/alerts/12', assignees: [{ login: 'octocat' }] }];
      }
      if (route === 'GET /repos/{owner}/{repo}/code-scanning/alerts' && params.state === 'closed') {
        return [
          { fixed_at: '2026-02-01T00:00:00Z' },
          { dismissed_at: '2025-12-01T00:00:00Z' },
        ];
      }
      throw new Error(`Unexpected pagination request: ${route}`);
    },
    request: async (route, params) => {
      calls.push([route, params]);
      assert.equal(route, 'GET /repos/{owner}/{repo}/properties/values');
      if (propertiesError) throw propertiesError;
      return { data: [{ property_name: 'owner', value: 'octocat' }] };
    },
  };
  return { github, calls };
}

const core = { info() {}, warning() {} };

test('collects repository data only for campaign-issue repositories', async () => {
  const { github, calls } = makeGithub({
    issues: [{
      title: '[Security campaign tracking] monica-test',
      repository_url: 'https://api.github.com/repos/octodemo/app',
      html_url: 'https://github.com/octodemo/app/issues/3',
      number: 3,
      state: 'open',
      updated_at: '2026-02-01T00:00:00Z',
    }],
  });

  const data = await collectCampaignData({ github, core, org: 'octodemo', prefix: 'monica-' });
  assert.equal(data.campaigns[0].repositories.length, 1);
  assert.equal(data.campaigns[0].repositories[0].repository, 'octodemo/app');
  assert.equal(data.campaigns[0].repositories[0].owner, 'octocat');
  assert.equal(data.campaigns[0].repositories[0].open_alerts_count, 1);
  assert.equal(data.campaigns[0].repositories[0].closed_alerts_count, 1);
  assert.deepEqual(
    calls.filter(([route]) => route === 'GET /repos/{owner}/{repo}/properties/values'),
    [['GET /repos/{owner}/{repo}/properties/values', { owner: 'octodemo', repo: 'app' }]],
  );
  assert.ok(calls.every(([route]) => !route.startsWith('GET /orgs/{org}/code-scanning/alerts')));
  assert.ok(calls.every(([route]) => route !== 'GET /orgs/{org}/properties/values'));
});

test('warns and continues collecting when repository custom properties cannot be read', async () => {
  const { github } = makeGithub({
    issues: [{
      title: '[Security campaign tracking] monica-test',
      repository_url: 'https://api.github.com/repos/octodemo/app',
      number: 3,
      state: 'open',
    }],
    propertiesError: new Error('Forbidden'),
  });
  const warnings = [];
  const data = await collectCampaignData({
    github,
    core: { info() {}, warning(message) { warnings.push(message); } },
    org: 'octodemo',
    prefix: 'monica-',
  });

  assert.equal(data.campaigns[0].repositories[0].owner, null);
  assert.equal(data.campaigns[0].repositories[0].open_alerts_count, 1);
  assert.equal(data.campaigns[0].repositories[0].closed_alerts_count, 1);
  assert.deepEqual(warnings, ['octodemo/app: unable to read repository custom properties: Forbidden']);
});

test('does not scan unrelated repositories when a campaign has no issues', async () => {
  const { github, calls } = makeGithub();
  const data = await collectCampaignData({ github, core, org: 'octodemo', prefix: 'monica-' });

  assert.equal(data.campaigns[0].repo_source, 'no-campaign-issues');
  assert.deepEqual(data.campaigns[0].repositories, []);
  assert.equal(calls.length, 2);
});

test('collects alert owners only from repositories linked to active campaigns', async () => {
  const calls = [];
  const github = {
    paginate: async (route, params) => {
      calls.push([route, params]);
      if (route === 'GET /orgs/{org}/campaigns') {
        return [
          { number: 7, name: 'Monica-test', state: 'open', alert_stats: { open_count: 2 } },
          { number: 8, name: 'monica-empty', state: 'open', alert_stats: { open_count: 0 } },
          { number: 9, name: 'other-campaign', state: 'open', alert_stats: { open_count: 5 } },
        ];
      }
      if (route === 'GET /search/issues') {
        assert.equal(params.q, 'org:octodemo is:issue in:title "Monica-test"');
        return [{
          title: '[Security campaign tracking] Monica-test',
          repository_url: 'https://api.github.com/repos/octodemo/app',
        }];
      }
      if (route === 'GET /repos/{owner}/{repo}/code-scanning/alerts') {
        assert.deepEqual(params, { owner: 'octodemo', repo: 'app', state: 'open', per_page: 100 });
        return [
          { number: 12, html_url: 'https://github.com/octodemo/app/alerts/12', assignees: [] },
          { number: 13, html_url: 'https://github.com/octodemo/app/alerts/13', assignees: [{ login: 'octocat' }] },
        ];
      }
      throw new Error(`Unexpected pagination request: ${route}`);
    },
    request: async (route, params) => {
      calls.push([route, params]);
      assert.equal(route, 'GET /repos/{owner}/{repo}/properties/values');
      assert.deepEqual(params, { owner: 'octodemo', repo: 'app' });
      return { data: [{ property_name: 'owner', value: 'octocat' }] };
    },
  };

  const data = await collectAlertOwnerData({ github, core, org: 'octodemo', prefix: 'monica-' });
  assert.deepEqual(data.campaigns.map(c => c.name), ['Monica-test', 'monica-empty']);
  assert.equal(data.repositories.length, 1);
  assert.deepEqual(data.repositories[0], {
    repository: 'octodemo/app',
    owner: 'octocat',
    open_alerts: 2,
    assigned_alerts: 1,
    unassigned_alerts: [{
      number: 12,
      rule: undefined,
      severity: undefined,
      url: 'https://github.com/octodemo/app/alerts/12',
    }],
    campaigns: ['Monica-test'],
  });
  assert.equal(data.totals.unassigned_open_alerts, 1);
  assert.ok(calls.every(([route]) => !route.startsWith('GET /orgs/{org}/code-scanning/alerts')));
  assert.equal(calls.filter(([route]) => route === 'GET /search/issues').length, 1);
});

test('falls back to org alerts and fails loudly when campaign alerts cannot be located', async () => {
  const warnings = [];
  const make = orgAlerts => ({
    paginate: async (route, params) => {
      if (route === 'GET /orgs/{org}/campaigns') {
        return [{ number: 7, name: 'monica-test', state: 'open', alert_stats: { open_count: 1 } }];
      }
      if (route === 'GET /search/issues') return [];
      if (route === 'GET /orgs/{org}/code-scanning/alerts') return orgAlerts;
      if (route === 'GET /repos/{owner}/{repo}/code-scanning/alerts') return [{ number: 3, html_url: 'u', assignees: [] }];
      throw new Error(`Unexpected pagination request: ${route}`);
    },
    request: async () => ({ data: [{ property_name: 'owner', value: 'octocat' }] }),
  });
  const warnCore = { info() {}, warning: m => warnings.push(m) };

  const data = await collectAlertOwnerData({
    github: make([{ repository: { full_name: 'octodemo/app' } }]), core: warnCore, org: 'octodemo', prefix: 'monica-',
  });
  assert.deepEqual(data.repositories.map(r => r.repository), ['octodemo/app']);
  assert.equal(data.totals.unassigned_open_alerts, 1);
  assert.equal(warnings.length, 1);

  await assert.rejects(
    collectAlertOwnerData({ github: make([]), core: warnCore, org: 'octodemo', prefix: 'monica-' }),
    /Could not locate all open alerts for campaign\(s\): monica-test \(1 open\)/,
  );
});

test('runs owner workflow when a repository is missing its owner property without unassigned alerts', () => {
  assert.equal(hasAlertOwnerWork({
    totals: { unassigned_open_alerts: 0 },
    repositories: [{ repository: 'octodemo/app', owner: null }],
  }), true);
  assert.equal(hasAlertOwnerWork({
    totals: { unassigned_open_alerts: 0 },
    repositories: [{ repository: 'octodemo/app', owner: 'octocat' }],
  }), false);
  assert.equal(hasAlertOwnerWork({
    totals: { unassigned_open_alerts: 1 },
    repositories: [{ repository: 'octodemo/app', owner: 'octocat' }],
  }), true);
});
