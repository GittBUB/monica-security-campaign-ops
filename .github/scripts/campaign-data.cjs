// Shared helpers used by the monica campaign agentic workflows.
// Load from actions/github-script with:
//   require(`${process.env.GITHUB_WORKSPACE}/.github/scripts/campaign-data.cjs`)

const DAY_MS = 24 * 60 * 60 * 1000;

function daysRemaining(endsAt, now = Date.now()) {
  if (!endsAt) return null;
  return Math.ceil((Date.parse(endsAt) - now) / DAY_MS);
}

function dueStatus(days) {
  if (days === null) return 'no due date';
  if (days < 0) return `overdue by ${-days} day(s)`;
  if (days === 0) return 'due today';
  return `${days} day(s) remaining`;
}

function daysLabel(days) {
  if (days === null) return '—';
  return days < 0 ? `${days} (overdue)` : String(days);
}

function formatDate(iso) {
  return iso ? iso.slice(0, 10) : '—';
}

function escapeMd(text) {
  return String(text ?? '').replace(/[|<>[\]`]/g, c => `\\${c}`).replace(/\r?\n/g, ' ');
}

function propertyValue(properties, name) {
  const prop = (properties || []).find(p => p.property_name === name);
  const value = Array.isArray(prop?.value) ? prop.value[0] : prop?.value;
  return value ? String(value).replace(/^@/, '').trim() : null;
}

function simplifyAlert(alert) {
  return {
    number: alert.number,
    url: alert.html_url,
    rule: alert.rule?.id || null,
    severity: alert.rule?.security_severity_level || alert.rule?.severity || null,
    assignees: (alert.assignees || []).map(a => a.login),
  };
}

/**
 * Finds the open campaigns whose name starts with `prefix`, the repositories included in each
 * campaign and the open/closed code scanning alerts of those repositories.
 *
 * Repositories are discovered through the campaign issues GitHub creates in each repository of a
 * campaign ("Create issues for N repositories in this campaign"): any issue in the organization
 * whose title contains the campaign name. The REST API does not list the alerts of a campaign, so
 * a repository's open alerts are all of its open code scanning alerts and its closed alerts are
 * the ones fixed or dismissed since the campaign was published.
 */
async function collectCampaignData({ github, core, org, prefix, ownerProperty = 'owner' }) {
  const now = Date.now();
  const lowerPrefix = prefix.toLowerCase();

  const allCampaigns = await github.paginate('GET /orgs/{org}/campaigns', { org, state: 'open', per_page: 100 });
  const matching = allCampaigns.filter(c => (c.name || '').toLowerCase().startsWith(lowerPrefix));
  core.info(`Found ${matching.length} open campaign(s) with prefix "${prefix}" in ${org}`);

  const openAlertsByRepo = new Map();
  async function getOpenAlerts(repository) {
    if (!openAlertsByRepo.has(repository)) {
      const [owner, repo] = repository.split('/');
      openAlertsByRepo.set(repository, github.paginate('GET /repos/{owner}/{repo}/code-scanning/alerts', {
        owner, repo, state: 'open', per_page: 100,
      }).then(alerts => alerts.map(simplifyAlert)));
    }
    return openAlertsByRepo.get(repository);
  }

  const ownerByRepo = new Map();
  async function getOwner(repository) {
    if (!ownerByRepo.has(repository)) {
      const [owner, repo] = repository.split('/');
      ownerByRepo.set(repository, github.request('GET /repos/{owner}/{repo}/properties/values', { owner, repo })
        .then(({ data }) => propertyValue(data, ownerProperty))
        .catch(error => {
          core.warning(`${repository}: unable to read repository custom properties: ${error.message}`);
          return null;
        }));
    }
    return ownerByRepo.get(repository);
  }

  async function mapWithConcurrency(items, limit, mapper) {
    const results = new Array(items.length);
    let next = 0;
    async function worker() {
      while (next < items.length) {
        const index = next++;
        results[index] = await mapper(items[index], index);
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
  }

  async function closedSince(repository, since) {
    const [owner, repo] = repository.split('/');
    try {
      const closed = await github.paginate('GET /repos/{owner}/{repo}/code-scanning/alerts', { owner, repo, state: 'closed', per_page: 100 });
      const sinceMs = since ? Date.parse(since) : 0;
      return closed.filter(a => Date.parse(a.fixed_at || a.dismissed_at || a.updated_at || 0) >= sinceMs).length;
    } catch (error) {
      core.warning(`${repository}: unable to list closed alerts: ${error.message}`);
      return null;
    }
  }

  const campaigns = [];
  for (const c of matching) {
    const days = daysRemaining(c.ends_at, now);
    const campaign = {
      number: c.number,
      name: c.name,
      state: c.state,
      url: `https://github.com/orgs/${org}/security/campaigns/${c.number}`,
      published_at: c.published_at || c.created_at,
      ends_at: c.ends_at,
      days_remaining: days,
      due_status: dueStatus(days),
      alert_stats: {
        open: c.alert_stats?.open_count ?? 0,
        closed: c.alert_stats?.closed_count ?? 0,
        in_progress: c.alert_stats?.in_progress_count ?? 0,
      },
      repo_source: 'campaign-issues',
      repositories: [],
    };

    core.info(`Finding campaign issues for "${c.name}"`);
    const issues = await github.paginate('GET /search/issues', {
      q: `org:${org} is:issue in:title "${c.name.replace(/"/g, '')}"`,
      per_page: 100,
    });
    const issueByRepo = {};
    for (const issue of issues) {
      if (!issue.title.toLowerCase().includes(c.name.toLowerCase())) continue;
      const repository = issue.repository_url.split('/repos/')[1];
      const current = issueByRepo[repository];
      const better = !current
        || (issue.state === 'open' && current.state !== 'open')
        || (issue.state === current.state && Date.parse(issue.updated_at) > Date.parse(current.updated_at));
      if (better) {
        issueByRepo[repository] = { number: issue.number, url: issue.html_url, state: issue.state, title: issue.title, updated_at: issue.updated_at };
      }
    }

    const repoNames = Object.keys(issueByRepo).sort((a, b) => a.localeCompare(b));
    if (repoNames.length === 0) {
      core.warning(`Campaign "${c.name}" has no campaign issues; no repositories can be identified`);
      campaign.repo_source = 'no-campaign-issues';
    }

    core.info(`Collecting alert and owner data for ${repoNames.length} repositories in "${c.name}"`);
    campaign.repositories = await mapWithConcurrency(repoNames, 5, async repository => {
      core.info(`Collecting ${repository}`);
      const [open, owner, closed] = await Promise.all([
        getOpenAlerts(repository),
        getOwner(repository),
        closedSince(repository, campaign.published_at),
      ]);
      return {
        repository,
        url: `https://github.com/${repository}`,
        owner,
        campaign_issue: issueByRepo[repository] || null,
        open_alerts_count: open.length,
        closed_alerts_count: closed,
        open_alerts: open,
      };
    });
    core.info(`Finished collecting data for "${c.name}"`);
    campaigns.push(campaign);
  }

  return { org, prefix, owner_property_name: ownerProperty, generated_at: new Date(now).toISOString(), campaigns };
}

/**
 * Collects open alerts only from repositories identified by issues for active campaigns.
 */
async function collectAlertOwnerData({ github, core, org, prefix, ownerProperty = 'owner' }) {
  const lowerPrefix = prefix.toLowerCase();
  const allCampaigns = await github.paginate('GET /orgs/{org}/campaigns', { org, per_page: 100 });
  const campaigns = allCampaigns
    .filter(c => (c.name || '').toLowerCase().startsWith(lowerPrefix))
    .map(c => ({
      number: c.number,
      name: c.name,
      state: c.state,
      ends_at: c.ends_at,
      url: `https://github.com/orgs/${org}/security/campaigns/${c.number}`,
      open_alerts: c.alert_stats?.open_count ?? 0,
      closed_alerts: c.alert_stats?.closed_count ?? 0,
      in_progress_alerts: c.alert_stats?.in_progress_count ?? 0,
    }));
  core.info(`Found ${campaigns.length} campaign(s) with prefix "${prefix}" in ${org}`);

  const activeCampaigns = campaigns.filter(c => c.state === 'open' && c.open_alerts > 0);
  const repositories = new Map();
  for (const campaign of activeCampaigns) {
    const queryName = campaign.name.replace(/"/g, '');
    const issues = await github.paginate('GET /search/issues', {
      q: `org:${org} is:issue in:title "${queryName}"`,
      per_page: 100,
    });
    for (const issue of issues) {
      if (!(issue.title || '').toLowerCase().includes(campaign.name.toLowerCase())) continue;
      const repository = issue.repository_url?.split('/repos/')[1];
      const [repositoryOwner, repositoryName, ...rest] = (repository || '').split('/');
      if (!repositoryOwner || !repositoryName || rest.length || repositoryOwner.toLowerCase() !== org.toLowerCase()) {
        continue;
      }
      const fullName = `${repositoryOwner}/${repositoryName}`;
      const entry = repositories.get(fullName) || {
        repository: fullName,
        owner: null,
        open_alerts: 0,
        assigned_alerts: 0,
        unassigned_alerts: [],
        campaigns: [],
      };
      if (!entry.campaigns.includes(campaign.name)) entry.campaigns.push(campaign.name);
      repositories.set(fullName, entry);
    }
  }

  // Campaign issues may be invisible to the token (for example without issues:read), so
  // campaigns without any discovered repository fall back to the organization's open alerts.
  let orgAlertRepositories;
  for (const campaign of activeCampaigns) {
    if ([...repositories.values()].some(r => r.campaigns.includes(campaign.name))) continue;
    core.warning(`No campaign issues found for "${campaign.name}"; falling back to repositories with open code scanning alerts in ${org}`);
    if (!orgAlertRepositories) {
      const orgAlerts = await github.paginate('GET /orgs/{org}/code-scanning/alerts', { org, state: 'open', per_page: 100 });
      orgAlertRepositories = [...new Set(orgAlerts.map(a => a.repository?.full_name).filter(Boolean))];
    }
    for (const fullName of orgAlertRepositories) {
      const entry = repositories.get(fullName) || {
        repository: fullName,
        owner: null,
        open_alerts: 0,
        assigned_alerts: 0,
        unassigned_alerts: [],
        campaigns: [],
      };
      if (!entry.campaigns.includes(campaign.name)) entry.campaigns.push(campaign.name);
      repositories.set(fullName, entry);
    }
  }

  const repos = [...repositories.values()].sort((a, b) => a.repository.localeCompare(b.repository));
  let next = 0;
  async function collectRepository(repo) {
    const [owner, name] = repo.repository.split('/');
    const [alerts, properties] = await Promise.all([
      github.paginate('GET /repos/{owner}/{repo}/code-scanning/alerts', {
        owner, repo: name, state: 'open', per_page: 100,
      }),
      github.request('GET /repos/{owner}/{repo}/properties/values', { owner, repo: name })
        .then(({ data }) => propertyValue(data, ownerProperty))
        .catch(error => {
          core.warning(`${repo.repository}: unable to read repository custom properties: ${error.message}`);
          return null;
        }),
    ]);
    repo.owner = properties;
    for (const alert of alerts) {
      repo.open_alerts++;
      if ((alert.assignees || []).length > 0) {
        repo.assigned_alerts++;
      } else {
        repo.unassigned_alerts.push({
          number: alert.number,
          rule: alert.rule?.id,
          severity: alert.rule?.security_severity_level || alert.rule?.severity,
          url: alert.html_url,
        });
      }
    }
  }
  async function worker() {
    while (next < repos.length) {
      const index = next++;
      await collectRepository(repos[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(5, repos.length) }, worker));

  const missing = activeCampaigns.filter(campaign => {
    const found = repos
      .filter(repo => repo.campaigns.includes(campaign.name))
      .reduce((sum, repo) => sum + repo.open_alerts, 0);
    return found < campaign.open_alerts;
  });
  if (missing.length) {
    throw new Error(
      `Could not locate all open alerts for campaign(s): ${missing.map(c => `${c.name} (${c.open_alerts} open)`).join(', ')}. ` +
      'Check that the token can read issues, code scanning alerts and campaigns in every repository.'
    );
  }

  return {
    org,
    campaign_prefix: lowerPrefix,
    owner_property_name: ownerProperty,
    campaigns,
    totals: {
      campaigns: campaigns.length,
      open_alerts: campaigns.reduce((sum, campaign) => sum + campaign.open_alerts, 0),
      closed_alerts: campaigns.reduce((sum, campaign) => sum + campaign.closed_alerts, 0),
      unassigned_open_alerts: repos.reduce((sum, repo) => sum + repo.unassigned_alerts.length, 0),
    },
    repositories: repos,
  };
}

function hasAlertOwnerWork(data) {
  return data.totals.unassigned_open_alerts > 0
    || data.repositories.some(repo => !repo.owner || !repo.owner.trim());
}

/** Builds the weekly summary markdown from collected campaign data. */
function renderSummaryMarkdown(data) {
  const lines = [];
  lines.push(`# Security campaign summary: ${escapeMd(data.prefix)}* — ${formatDate(data.generated_at)}`, '');
  if (data.campaigns.length === 0) {
    lines.push(`No open campaigns matching \`${escapeMd(data.prefix)}\` were found in **${escapeMd(data.org)}**.`);
    return lines.join('\n');
  }

  lines.push('| Campaign | Due date | Days remaining | Open alerts | Closed alerts | In progress |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const c of data.campaigns) {
    lines.push(`| [${escapeMd(c.name)}](${c.url}) | ${formatDate(c.ends_at)} | ${daysLabel(c.days_remaining)} | ${c.alert_stats.open} | ${c.alert_stats.closed} | ${c.alert_stats.in_progress} |`);
  }
  lines.push('');

  for (const c of data.campaigns) {
    lines.push(`## [${escapeMd(c.name)}](${c.url})`, '');
    lines.push(`- **Due date:** ${formatDate(c.ends_at)}`);
    lines.push(`- **Days remaining:** ${daysLabel(c.days_remaining)}`);
    lines.push(`- **Campaign totals:** ${c.alert_stats.open} open, ${c.alert_stats.closed} closed, ${c.alert_stats.in_progress} in progress`);
    if (c.repo_source === 'no-campaign-issues') {
      lines.push('- ⚠️ No campaign issues were found, so repository-level alert details are unavailable.');
    }
    lines.push('');

    for (const r of c.repositories) {
      lines.push(`### [${escapeMd(r.repository)}](${r.url})`, '');
      lines.push(`- **Campaign:** [${escapeMd(c.name)}](${c.url}) — due ${formatDate(c.ends_at)} (${c.due_status})`);
      if (r.campaign_issue) lines.push(`- **Campaign issue:** [#${r.campaign_issue.number}](${r.campaign_issue.url}) (${r.campaign_issue.state})`);
      lines.push(`- **Repository owner:** ${r.owner ? escapeMd(r.owner) : '_not set_'}`);
      lines.push(`- **Open alerts:** ${r.open_alerts_count}`);
      lines.push(`- **Closed alerts:** ${r.closed_alerts_count ?? 'unknown'}`, '');
      if (r.open_alerts.length > 0) {
        lines.push('| Alert | Rule | Severity | Assignee |', '| --- | --- | --- | --- |');
        for (const a of r.open_alerts) {
          // Logins are not @-mentioned so the summary does not notify everyone every week.
          const who = a.assignees.length ? a.assignees.map(escapeMd).join(', ') : '**unassigned**';
          lines.push(`| [#${a.number}](${a.url}) | ${escapeMd(a.rule || '—')} | ${escapeMd(a.severity || '—')} | ${who} |`);
        }
        lines.push('');
      }
    }
  }
  return lines.join('\n');
}

/**
 * Builds the reminder comment for one repository of a campaign. Each assignee is @-mentioned
 * with links to the open alerts assigned to them.
 */
function renderReminderComment({ campaign, repository, note, runUrl }) {
  const byAssignee = {};
  const unassigned = [];
  for (const a of repository.open_alerts) {
    if (a.assignees.length === 0) unassigned.push(a);
    for (const login of a.assignees) (byAssignee[login] ??= []).push(a);
  }
  const lines = [];
  lines.push(`### Weekly reminder: [${escapeMd(campaign.name)}](${campaign.url})`, '');
  lines.push(`**Due date:** ${formatDate(campaign.ends_at)} (${campaign.due_status}) · **Open alerts in this repository:** ${repository.open_alerts_count}`, '');
  if (note) lines.push(note, '');
  for (const login of Object.keys(byAssignee).sort()) {
    lines.push(`@${login}, these open alerts are assigned to you:`);
    for (const a of byAssignee[login]) {
      lines.push(`- [Alert #${a.number}](${a.url})${a.rule ? ` — \`${a.rule.replace(/`/g, '')}\`` : ''}${a.severity ? ` (${escapeMd(a.severity)})` : ''}`);
    }
    lines.push('');
  }
  if (unassigned.length) {
    lines.push(`${unassigned.length} open alert(s) have no assignee yet: ${unassigned.map(a => `[#${a.number}](${a.url})`).join(', ')}`, '');
  }
  lines.push(`<sub>Posted by the [monica campaign weekly reminder](${runUrl}) workflow.</sub>`);
  return lines.join('\n');
}

module.exports = { collectCampaignData, collectAlertOwnerData, hasAlertOwnerWork, renderSummaryMarkdown, renderReminderComment, daysRemaining, dueStatus, escapeMd, propertyValue };
