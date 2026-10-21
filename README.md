# monica-security-campaign-ops

## Purpose and outcome

Run a repeatable security-campaign operations loop for **one GitHub organization from one
central automation repository**:

1. Find campaigns matching a configured name prefix.
2. Establish accountability by assigning eligible unassigned code scanning alerts to a
   repository's designated owner.
3. Remind existing alert assignees through campaign issue comments.
4. Publish a recurring status report with deadlines, alert counts and links.

The result is clearer ownership, recurring follow-up and a shared progress view across
repositories. **This workflow does not fix vulnerabilities, create remediation pull requests,
or guarantee that campaigns finish on time.** Developers still investigate, remediate and
validate their alerts.

Its focus is **existing code scanning alerts associated with the repository-level view of
selected security campaigns**, not every security product or an exact campaign-alert inventory.
Read [scope and limitations](#scope-and-limitations) before enabling writes.

> **Public distribution is not the same as public execution.** You can distribute the workflow
> source in a public repository, but run it in a private automation repository when the target
> organization contains nonpublic security data. Reports, missing-owner issues, Actions logs
> and artifacts can expose repository names, alert links, assignees and security status to
> people with access to the automation repository. Source-repository access restrictions do
> not automatically protect copied report content.

## Jira alternative

Using Jira instead of GitHub Issues? See the [Jira alternative research and implementation
considerations](docs/jira-alternative.md) for supported MCP integration, authentication,
required workflow changes and relevant documentation. This is a feasibility guide, not an
implemented Jira mode; the workflows in this repository still use GitHub Issues.

## Organization-wide setup: step by step

### 1. Choose the target organization and a central execution repository

- Choose one organization, for example `YOUR-ORG`. A run targets one organization, not an
  enterprise or several organizations at once.
- Copy this repository's files into a central automation repository, preferably private and
  owned by the target organization. You do **not** need to install the workflows in every
  application repository.
- Keep Actions or these three workflows disabled while configuring and reviewing scope.
  A new independent copy may otherwise start scheduled runs once workflows are on its default
  branch.
- Enable Issues in the central repository: summaries and missing-owner reports are posted there.
- Decide who may read the resulting reports and who may modify the workflows or their secrets.

The repository may be hosted outside the target organization, but you must explicitly set
`CAMPAIGN_ORG` and grant the credential access to the target organization. Review the central
repository's Actions and Copilot policies separately from the target organization's data access.

### 2. Check prerequisites with an organization administrator

- Security campaigns and code scanning must be available and configured for the target
  organization and participating repositories, including any required GitHub Code Security
  entitlement.
- Campaigns must already exist; these workflows do not create them or run code scanning.
- The credential must have campaign access through the required organization-owner or security
  manager role, as well as the permissions in [Required permissions](#required-permissions).
- Organization and repository Actions policies must allow the referenced actions, GitHub-hosted
  Ubuntu runners, artifact handling and the compiled GitHub Agentic Workflows.
- The execution repository must be permitted to use the configured gh-aw Copilot engine,
  including `copilot-requests: write` and applicable billing/usage policies. See
  [gh-aw authentication](https://github.github.com/gh-aw/reference/auth/).
- Participating repositories must support Issues so campaign issues can be discovered and
  reminder comments can be posted.

### 3. Define campaign scope and publish campaign issues

Choose a nonempty prefix shared by the campaigns you want to operate, such as `security-`.
For example, `security-dependencies-q4` and `security-injection-q4` both match.
Matching is a **case-insensitive starts-with check**. `monica-` is only the sample default;
you do not need to rename workflow files to use another prefix.

When publishing each campaign, select **Create issues for N repositories in this campaign**.
Keep the campaign name in each issue title. For an existing campaign without issues, arrange
for a matching issue in each participating repository and verify the discovered set manually.
Use distinct campaign names: title matching is not a dedicated campaign-membership lookup.

**Important:** organization-wide means centrally covering accessible repositories for matching
campaigns, not automatically enrolling every repository or processing every campaign.

> **Assignment scope can expand:** if an open matching campaign has open alerts but no
> discoverable matching issues, the owner collector falls back to the organization's open
> code scanning alerts. It can then assign unassigned alerts outside that campaign's intended
> repository set. Missing Issues permission can also trigger this fallback. Do not enable
> assignment writes until you have checked issue discovery and the actual dry-run scope.
> Weekly summaries and reminders do not use this fallback.

### 4. Choose a custom property for alert assignment

**You do not need a property named `owner`, and the assignee does not have to be the
repository owner.** `owner` is only the default property name. You can reuse an existing
repository custom property or create a different string property in the target organization's
custom-property settings to represent the person accountable for follow-up.

Examples include:

| Custom property | Example value | Possible responsibility |
| --- | --- | --- |
| `product_manager` | `alice` | Coordinate product prioritization and remediation commitments. |
| `project_manager` | `bob` | Track remediation delivery and campaign deadlines. |
| `lead_engineer` | `charlie` | Investigate findings and coordinate technical fixes. |
| `security_champion` | `dana` | Triage findings and coordinate security follow-up. |

These names and responsibilities are examples, not special built-in fields. You may create
several properties on a repository, but the current workflow reads **one selected assignment
property per run**. For example, set `CAMPAIGN_OWNER_PROPERTY` to `lead_engineer` in step 6,
then populate `lead_engineer` with the appropriate person's login on every repository that may
be processed. The variable retains its existing name even when the property is not `owner`.

Each selected property must contain **one individual GitHub login**, optionally prefixed with
`@`, not a display name, team slug, email address or list. Job title alone does not grant
assignment eligibility: the person must have the required repository access, including write
access for alert assignment. A product or project manager without that access cannot be used
as the alert assignee merely because their login is in a property.

These custom properties are separate from `CODEOWNERS`; the workflow does not read
`CODEOWNERS` to decide alert ownership. Repository-specific property values allow different
people to receive alerts in different repositories while using the same selected property name.

#### Ideas for routing different alerts to different properties

The following are **possible workflow customizations, not current capabilities**. Adding
multiple custom properties alone does not enable routing. Today, every eligible unassigned
alert processed in a run uses that run's selected property, and existing assignees are preserved.

| Possible routing criterion | Example idea |
| --- | --- |
| Campaign name or prefix | Route `security-code-*` campaigns to `lead_engineer` and `security-delivery-*` campaigns to `project_manager`. |
| Alert severity | Route critical/high findings to `security_champion` and lower-severity findings to `lead_engineer`. |
| Rule ID or rule family | Route injection-related rules to `backend_lead` and browser-related rules to `frontend_lead`. |
| Code scanning tool | Route findings from different code scanning tools to properties for their respective specialists. |
| Repository classification | Use a `service_type` or `business_unit` property to choose between `platform_lead` and `application_lead`. |
| Deadline or escalation policy | Route initial triage to `lead_engineer`, and design separate overdue notifications for `project_manager` or `product_manager` rather than granting them alert-assignment access. |

Implementing these ideas would require updating collection, routing rules, the agent prompt and
write-side validation together, then recompiling the workflows and testing dry runs. Some
criteria also require collecting additional data. Define rule precedence, behavior when a
property is missing, and how existing assignments should be handled before enabling writes.

**Campaign-based routing needs particular care:** the current repository-level alert lists are
not exact campaign-alert membership, and assignment can fall back to organization-wide
repositories. Separate runs with different prefixes/properties are therefore not reliable
per-campaign routing: alert sets can overlap, and the first run can assign alerts the next run
would otherwise consider. Establish verified campaign membership and an explicit overlap policy
before implementing campaign-specific assignment.

### 5. Configure organization-wide authentication

Follow either [GitHub App setup](#option-b-github-app-recommended-for-long-term-use)
(recommended for ongoing operations) or [fine-grained PAT setup](#option-a-fine-grained-personal-access-token).

- Cover **all repositories** in the target organization for full organization-wide operation,
  including future repositories. Selected-repository access limits coverage and requires
  ongoing installation/token maintenance.
- Grant the exact organization and repository permissions listed below.
- For an App, install it on the target organization and configure the required role access.
- Save credentials only as Actions secrets in the execution repository; never commit them.
- App configuration takes precedence over a PAT. Do not leave an incomplete App configuration
  enabled and expect the PAT to rescue a failed token-generation step.

Secrets, variables, App installations and organization roles are **not copied with Git files**.
Configure them separately in each execution repository.

### 6. Configure the central repository's variables

Under **Settings -> Secrets and variables -> Actions -> Variables**, set:

| Variable | Example | Meaning |
| --- | --- | --- |
| `CAMPAIGN_ORG` | `YOUR-ORG` | Target organization; set explicitly even if it owns the execution repository. |
| `CAMPAIGN_PREFIX` | `security-` | Prefix for the campaigns to process on scheduled runs. |
| `CAMPAIGN_OWNER_PROPERTY` | `owner` | Custom property containing the individual owner login. |

For manual runs, `org` and `campaign_prefix` inputs override variables when nonempty.
**The manual prefix input defaults to `monica-`.** Explicitly replace it with your chosen
prefix on every manual test; otherwise it overrides `CAMPAIGN_PREFIX`.

### 7. Review the compiled workflows and enable controlled testing

The three compiled `.lock.yml` files must be present on the execution repository's default
branch. If you only change Actions variables/secrets, no recompilation is needed.
If you edit workflow source configuration or prompts, follow
[Changing a workflow](#changing-a-workflow) and commit both source and regenerated output.

Enable Actions and the workflows when ready. Their schedules become eligible to run immediately;
keep individual workflows disabled until you are ready to test them if necessary. Schedules
are independent, not a guaranteed assignment -> summary -> reminders dependency chain.

### 8. Preview assignment and reminder scope

In **Actions**, run **Monica Campaign Alert Owner Assignment** with:

- `org`: your target organization
- `campaign_prefix`: your chosen prefix
- `dry_run`: `true`

Inspect collection logs, the assignment result table and warnings. Confirm the discovered
repositories, owner values and alert numbers. Look specifically for the organization-wide
fallback warning, missing properties and permission errors.

`dry_run` suppresses alert-assignment writes, **not every possible side effect**: the separate
missing-owner issue output is not guarded by this input and may still create an issue in the
execution repository. Collection, AI processing, logs and artifacts still occur.

Run **Monica Campaign Weekly Reminders** with the same organization and prefix and
`dry_run: true`. Review proposed comments in the job log and their status in the summary.
If no open alerts have assignees yet, it may have nobody to notify.

### 9. Enable writes and verify the outcome

1. Run owner assignment with `dry_run: false`. Verify a sample alert has the expected owner;
   existing assignees must remain unchanged. Check failed/skipped rows, not just the overall
   Actions conclusion.
2. Run weekly reminders with `dry_run: true` again after assignments, then with
   `dry_run: false` when the proposed recipients and content are correct.
3. Run **Monica Campaign Weekly Summary** with the correct organization and prefix.
   **It has no `dry_run` input:** a successful publishing step creates a real summary issue
   and supersedes previous open issues carrying the `campaign-summary` label.
4. Confirm the new summary issue, run summary and downloadable `campaign-summary` artifact.
   Compare campaign totals with GitHub's campaign view. Treat repository-level counts as the
   broader operational view described below, not exact campaign totals.
5. Verify visibility: sensitive organization data must not be published in a public execution
   repository.

### 10. Operate and maintain organization-wide coverage

Leave the schedules enabled after validation. Maintain owner properties, campaign issue titles,
App installation coverage and credential expiration/rotation. Review warnings and skipped or
failed operations after each run. Check Actions/Copilot usage, API limits and runtime as the
organization grows. Start with a narrow pilot prefix, then give additional campaigns that prefix
once the observed scope and results meet your expectations.

For multiple target organizations, use separately configured execution repositories or manually
dispatch one organization at a time with an appropriately authorized credential. There is no
built-in multi-organization scheduler.

## Workflow reference

Automation for running GitHub [security campaigns](https://docs.github.com/en/code-security/securing-your-organization/fixing-security-alerts-at-scale/about-security-campaigns).
The repository has three [GitHub Agentic Workflows](https://github.github.com/gh-aw/) (gh-aw)
for the organization's open campaigns whose name starts with `monica-`:

| Workflow | Schedule | What it does |
| --- | --- | --- |
| [Alert owner assignment](#alert-owner-assignment) | Weekdays, around 06:00 UTC | Assigns each repository's `owner` to its open, unassigned alerts. |
| [Weekly reminders](#weekly-reminders) | Mondays, around 09:00 UTC | Comments on each repository's open campaign issue and @-mentions every assignee with links to their open alerts. |
| [Weekly summary](#weekly-summary) | Mondays, around 08:00 UTC | Publishes a markdown summary per campaign and repository as an issue in this repository. |

Each workflow can also be started manually from the **Actions** tab (`workflow_dispatch`) if a
scheduled run is skipped or you want an extra run.

## How it works

All three workflows follow the same pattern:

1. **Collect data (deterministic job `collect_campaign_data`).** A normal Actions job uses your
   token to read campaigns, repositories, alerts and custom properties, and saves the results as
   an artifact. If there is nothing to do, the AI agent is skipped and no AI credits are used.
2. **Analyze (AI agent).** The agent reads the collected data. It doesn't have your token or any
   write access. It reviews progress, writes a report and requests write actions through typed
   tools.
3. **Threat detection.** gh-aw checks the agent output before anything is written.
4. **Write (custom safe-output job).** A separate job checks every request against the trusted
   data or live API data before it changes anything, and writes a results table to the job
   summary.

```
cron / manual run
      │
      ▼
collect_campaign_data ──► agent (read-only) ──► detection ──► safe-output job (writes)
```

### Which repositories and alerts belong to a campaign

The implementation uses campaign API alert **counts** (open, closed, in progress), but does not
retrieve an exact list of alert membership for each campaign. Instead:

- **Repositories in a campaign:** when a code campaign is published with **Create issues for N
  repositories in this campaign**, GitHub opens a campaign issue in each repository. The weekly
  workflows treat every repository with an issue whose title contains the campaign name as part
  of that campaign. If a campaign has no campaign issues, the summary flags that repository-level
  details are unavailable. Reminders are only posted on campaign issues.
- **Open alerts of a repository:** all of the repository's open code scanning alerts.
- **Closed alerts of a repository:** code scanning alerts fixed or dismissed since the campaign
  was published.
- Campaign-level totals in the summary come directly from the campaign API and are exact.

The weekly summary and reminder workflows request alert and custom-property data only for
repositories identified by campaign issues; they do not scan every repository or alert in the
organization. If a repository is in more than one `monica-` campaign, its alerts are listed under
each of them (or under each matching campaign when using a different prefix). Do not add those
repository counts together as a deduplicated organization total.

### Alert owner assignment

Source: `.github/workflows/monica-campaign-alert-owners.md`

1. **Collect:** keeps the campaigns whose name starts with `monica-` (case-insensitive) and
   records their open, closed and in-progress counts. Finds repositories through matching
   campaign issues, then queries only those repositories' open code scanning alerts, flags the
   ones with **no assignee**, and reads each repository's `owner`
   [custom property](https://docs.github.com/en/organizations/managing-organization-settings/managing-custom-properties-for-repositories-in-your-organization).
   The agent also runs when there are missing `owner` values, even if there are no alerts to
   assign.
2. **Agent:** reports campaign progress and makes one `assign_alert_owner` request per
   repository. Repositories whose `owner` is missing or invalid are listed in the report, and an issue listing the repositories with no `owner` value is created. Team
   slugs, email addresses and lists of names count as invalid.
3. **Write (`assign_alert_owner`):** the repository must belong to the organization, the
   assignee must match the repository's current `owner` property, and each alert must still be
   open and unassigned. It then sets the owner as the alert assignee.

This workflow first discovers repositories through issues for matching campaigns that are open
and have open alerts. **If any such campaign has no discovered repositories, it falls back to
repositories returned by the organization's open code scanning alerts endpoint.** It then
processes those repositories' open, unassigned alerts, not an exact campaign-alert subset.
If discovered repository open-alert counts are below an active campaign's open count, collection
fails with an access/coverage error; passing that check does not prove exact campaign membership.

The assignment writer rechecks the target organization, current owner property and live alert
state before writing. It does not independently revalidate campaign membership for each alert.

### Weekly reminders

Source: `.github/workflows/monica-campaign-weekly-reminders.md`

1. **Collect:** finds each campaign's repositories and campaign issues, and the open alerts with
   their assignees.
2. **Agent:** for every repository with an **open** campaign issue and at least one **assigned**
   open alert, it calls `notify_campaign_issue` with a short note about urgency and progress.
3. **Write (`notify_campaign_issue`):** builds the comment from the collected data, not from the
   agent. The comment shows the campaign link and due date, and has one section per assignee:
   `@login`, followed by links to the open alerts assigned to them. Unassigned open alerts are
   listed without a mention. The agent's note is reduced to plain text: mentions, links and HTML
   are removed. The job skips closed issues and repositories it doesn't know about, and posts at
   most one reminder per issue per week, so a manual re-run doesn't notify people twice.

A manual run accepts `dry_run: true` to preview the comments in the job log and summary without
posting them.

### Weekly summary

Source: `.github/workflows/monica-campaign-weekly-summary.md`

1. **Collect:** builds the full markdown report from the data. The report is generated by code,
   not by the AI, so the numbers and links are exact. For each campaign and each repository in
   the campaign it shows:
   - the campaign name and link, due date and days remaining
   - the number of open alerts
   - the number of closed alerts
   - a list of open alert links with their assignees
2. **Agent:** reads the report and writes a few highlights, such as overdue campaigns, the
   repositories with the most open alerts and unassigned alerts.
3. **Write (`publish_campaign_summary`):** creates an issue in **this** repository titled
   `[campaign-summary] Security campaign summary — <date>`. The issue has the highlights followed
   by the full report and the label `campaign-summary`. Last week's summary issue is closed with
   a link to the new one.

The same markdown is also shown in the run summary and saved as the `campaign-summary` artifact
(`campaign-summary.md` plus the raw `campaign-data.json`) for 90 days. Assignees are written as
plain logins in the summary so it doesn't notify everyone every week. The reminders workflow
handles notifications.

### Scope and limitations

- Only code scanning alerts are covered. Secret scanning campaigns aren't supported.
  Dependabot alerts, general vulnerability management, scan configuration and remediation
  pull requests are outside this workflow's scope.
- Weekly summaries and reminders process open campaigns matching the prefix. Assignment
  collects matching campaign statistics but only discovers work from campaigns that are open
  and have a positive open-alert count.
- A discovered repository's **entire open code scanning alert set** is used, including alerts
  outside the campaign. Closed repository counts are alerts fixed or dismissed since publication,
  not necessarily alerts closed from that campaign. No severity filter narrows this set.
- Assignment can broaden to organization-wide open-alert repositories when issue discovery
  finds none for an active campaign. Summary/reminder discovery instead reports missing details
  or has nobody to notify. Neither behavior is proof that the organization has no alerts.
- The selected assignment custom property (`owner` by default) must contain a single GitHub
  **user** login, with or without a
  leading `@`. Alert assignees must have write access to the repository. Existing assignments
  are not replaced or redistributed. Missing values are reported; owner properties are not
  created or repaired automatically.
- Campaign issues are matched by title, not a verified membership ID. Renaming campaigns or
  issue titles can change discovery; similar names or unrelated matching issues can add
  repositories. Weekly collection chooses one issue per repository per campaign, preferring an
  open issue and then the most recently updated issue.
- Reminders require an open campaign issue and at least one assigned open alert. Unassigned-only
  repositories are skipped. The weekly marker deduplicates per campaign/repository using a
  Monday-based UTC week; it is not one reminder per user across the organization.
- The summary creates a new issue on each successful publication, even on same-day reruns,
  and closes previous open non-PR issues labeled `campaign-summary`. Reserve that label for
  these reports. The issue body is truncated near 65,000 characters; download the artifact for
  the complete generated report.
- Output-call limits are 100 repository assignment requests, 200 campaign/repository reminder
  requests and one summary publication per run. Each assignment request may contain many
  alerts. Large organizations may exceed these limits, API/search limits or job timeouts;
  pagination does not remove GitHub Search's result cap.
- Data is a point-in-time snapshot. Assignment rechecks live owners and alerts; reminders
  recheck issue state but use collected alert/assignee data. Concurrent changes can affect results.
- AI analysis requests the output actions; collection and write validation are deterministic,
  but a completed run is not a guarantee every eligible action was requested or succeeded.
  Review output tables, warnings and artifacts.
- Custom-property read failures can appear as missing owners with a warning. Closed-alert
  read failures become `unknown` in summaries. Investigate those warnings rather than
  interpreting missing values as zero.
- `dry_run` is not a universal read-only mode. Assignment may still create a missing-owner
  issue, reminders still collect/process data, and the weekly summary has no manual dry-run input.
- Actions schedules can be delayed or skipped and do not enforce workflow ordering. Scheduled
  workflows in public repositories can be disabled after 60 days without repository activity.
- The workflows do not create campaigns, enforce remediation deadlines, close campaign issues
  or campaigns, or resolve alerts. Their outcome is operational accountability and visibility,
  not automatic remediation or compliance certification.

### Repository layout

| Path | Purpose |
| --- | --- |
| `.github/workflows/monica-campaign-*.md` | Workflow sources: frontmatter configuration plus the agent prompt. **Edit these files.** |
| `.github/workflows/monica-campaign-*.lock.yml` | Compiled GitHub Actions workflows generated by `gh aw compile`. **Don't edit them by hand.** |
| `.github/scripts/campaign-data.cjs` | Shared data collection and markdown rendering used by the weekly workflows. |
| `CODEOWNERS` | Code owners for this repository. |

### Configuration

All configuration is optional. Set these values under **Settings → Secrets and variables →
Actions → Variables**:

| Variable | Default | Description |
| --- | --- | --- |
| `CAMPAIGN_ORG` | Owner of this repository | Organization to scan. |
| `CAMPAIGN_PREFIX` | `monica-` | Campaign name prefix. |
| `CAMPAIGN_OWNER_PROPERTY` | `owner` | Name of the repository custom property that holds the owner login. |

Manual runs accept `org` and `campaign_prefix` inputs. The assignment and reminder workflows
also accept `dry_run: true`, which previews the changes in the job summary without changing any
alert or posting any comment.

### Changing a workflow

1. Install the CLI: `gh extension install github/gh-aw`
2. Edit the workflow's `.md` file, or `.github/scripts/campaign-data.cjs`. The script is loaded at
   runtime, so changing it doesn't require recompiling.
3. Recompile: `gh aw compile`
4. Commit both the `.md` file and the regenerated `.lock.yml` file.

When using a source-built compiler, pass `--action-tag <full gh-aw commit SHA>` to compile
with remote actions. Dev-mode local actions can be removed by later repository checkouts,
breaking their post-job cleanup.

Scheduled workflows only run from the default branch, so merge your changes before you expect
the cron trigger to pick them up.

## Setup

The built-in `GITHUB_TOKEN` can't read organization campaigns, organization custom properties or
alerts and issues in other repositories, so the workflows need either a **fine-grained personal access
token (PAT)** or a **GitHub App**. Configure **one** of the two options below. If both are set,
the GitHub App is used.

AI inference uses the workflow's `copilot-requests: write` permission and bills Copilot usage
to the organization, so no extra Copilot token is needed. See the
[gh-aw authentication docs](https://github.github.com/gh-aw/reference/auth/) for alternatives
such as `COPILOT_GITHUB_TOKEN`.

### Required permissions

| Scope | Permission | Access | Used for |
| --- | --- | --- | --- |
| Organization | Campaigns | Read-only | `GET /orgs/{org}/campaigns` |
| Organization | Custom properties | Read-only | `GET /orgs/{org}/properties/values` |
| Repository | Code scanning alerts | Read and write | List alerts and set assignees |
| Repository | Issues | Read and write | Find campaign issues and post weekly reminder comments |
| Repository | Metadata | Read-only (mandatory) | `GET /repos/{owner}/{repo}/properties/values` |

The weekly summary issue is created in this repository with the workflow's built-in
`GITHUB_TOKEN`, so it doesn't need any extra permission.

The campaigns API also requires the identity to be an **organization owner** or have the
**security manager** role.

### Option A: Fine-grained personal access token

1. **Check the organization policy.** An organization owner opens **Organization Settings →
   Personal access tokens → Settings** and makes sure fine-grained tokens are allowed. If
   approval is required, approve the token after step 6.
2. **Make sure the token owner has enough access.** The user who creates the token must be an
   organization owner or have the security manager role (**Organization Settings → Organization
   roles → Role assignments**).
3. **Start a new token.** Go to **your avatar → Settings → Developer settings → Personal access
   tokens → Fine-grained tokens → Generate new token**.
4. **Fill in the basics:**
   - **Token name:** `monica-security-campaign-ops`
   - **Expiration:** your organization's maximum, for example 90 days. Set a reminder to rotate it.
   - **Resource owner:** the organization that owns the campaigns. Choose the organization,
     not your personal account.
5. **Choose repository access:** select **All repositories** so the token can reach every
   repository that may have campaign alerts.
6. **Set permissions:**
   - **Repository permissions:** set **Code scanning alerts** to **Read and write** and
     **Issues** to **Read and write**. **Metadata** is set to **Read-only** automatically.
   - **Organization permissions:** set **Campaigns** to **Read-only** and **Custom properties**
     to **Read-only**.

   Click **Generate token** and copy the value. If the organization requires approval, the
   token can't be used until an owner approves it.
7. **Save the token as a secret in this repository.** Go to **Settings → Secrets and variables →
   Actions → New repository secret**:
   - **Name:** `CAMPAIGN_OPS_TOKEN`
   - **Secret:** the token value

   With the CLI (replace `YOUR-ORG/campaign-ops` with the execution repository):

   ```bash
   gh secret set CAMPAIGN_OPS_TOKEN --repo YOUR-ORG/campaign-ops
   ```
8. **Optional:** set the `CAMPAIGN_ORG` variable if the campaigns are in a different
   organization than this repository.
9. **Test it.** Run each workflow manually (**Actions → *workflow name* → Run workflow**). Use
   `dry_run: true` for **Monica Campaign Alert Owner Assignment** and **Monica Campaign Weekly
   Reminders**, then check the job summaries.

Assignments and reminder comments made with a PAT appear as made by the token's owner.

### Option B: GitHub App (recommended for long-term use)

A GitHub App isn't tied to a person, its tokens expire after one hour, and its actions are
attributed to the app.

1. **Create the app.** An organization owner goes to **Organization Settings → Developer
   settings → GitHub Apps → New GitHub App**.
2. **Fill in the basics:**
   - **GitHub App name:** for example `monica-security-campaign-ops`
   - **Homepage URL:** the URL of this repository
   - **Webhook:** clear **Active**. No webhook is needed.
3. **Set permissions:**
   - **Repository permissions:** set **Code scanning alerts** to **Read and write** and
     **Issues** to **Read and write**. Leave **Metadata** at **Read-only**.
   - **Organization permissions:** set **Campaigns** to **Read-only** and **Custom properties**
     to **Read-only**.
4. **Limit installation:** under **Where can this GitHub App be installed?**, choose **Only on
   this account**, then click **Create GitHub App**.
5. **Note the Client ID** shown on the app's **General** page. It looks like `Iv23...`.
6. **Generate a private key.** On the same page, click **Generate a private key** under
   **Private keys**. A `.pem` file is downloaded.
7. **Install the app.** Click **Install App** in the sidebar, choose the organization, select
   **All repositories**, and click **Install**.
8. **Grant the security manager role if needed.** If the collection job gets `404` from
   `/orgs/{org}/campaigns`, give the app the security manager role under **Organization
   Settings → Organization roles → Role assignments**.
9. **Save the credentials in this repository.** Go to **Settings → Secrets and variables →
   Actions** and add:
   - **Variables tab:** `CAMPAIGN_OPS_APP_CLIENT_ID` = the Client ID from step 5
   - **Secrets tab:** `CAMPAIGN_OPS_APP_PRIVATE_KEY` = the full contents of the `.pem` file,
     including the `BEGIN`/`END` lines

   With the CLI:

   ```bash
   gh variable set CAMPAIGN_OPS_APP_CLIENT_ID --repo YOUR-ORG/campaign-ops --body "YOUR_APP_CLIENT_ID"
   gh secret set CAMPAIGN_OPS_APP_PRIVATE_KEY --repo YOUR-ORG/campaign-ops < path/to/key.pem
   ```

   Delete the local `.pem` file after you upload it.
10. **Test it.** Run each workflow manually, using `dry_run: true` where available, and check
    the job summaries. Reminder comments are posted as `<app-name>[bot]`.

Each job mints a short-lived installation token for the organization, limited to the
permissions above. The token is revoked when the job ends. Because the affected repositories
are only known at runtime, the token isn't limited to specific repositories. That is why the
workflows set `strict: false`.

If you already created the app for the alert owner assignment workflow, add the **Issues: Read
and write** permission under **Developer settings → GitHub Apps → *your app* → Permissions &
events**. Then accept the new permission on the organization's installation page.

### Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `404` on `/orgs/{org}/campaigns` | The token or app is missing the **Campaigns** permission, or the identity isn't an organization owner or security manager. |
| `403` on `/orgs/{org}/properties/values` | The **Custom properties** organization permission is missing. |
| `403` when assigning an alert | **Code scanning alerts** isn't set to **Read and write**, or the repository isn't covered by the token or installation. |
| `422` when assigning an alert | The `owner` login doesn't exist or doesn't have write access to the repository. |
| Repository listed as "missing owner" | Set the `owner` custom property on that repository. |
| `403` when posting a reminder comment | The **Issues: Read and write** permission is missing, or the repository isn't covered by the token or installation. |
| A repository is missing from the weekly summary or reminders | The repository has no issue whose title contains the campaign name. Publish the campaign with **Create issues** enabled, or create the issue manually. |
| A user isn't notified | Their alerts are unassigned, or the repository's campaign issue is closed. Run the alert owner assignment workflow, or reopen the issue. |
| Assignment includes unexpected repositories | Check for the organization-wide fallback warning and missing campaign issues/Issues permission. Also check for unrelated issues matching campaign names. Stop writes until the discovered scope is understood. |
| Manual runs ignore the configured prefix | The nonempty manual `campaign_prefix` input overrides the variable and defaults to `monica-`. Enter your intended prefix explicitly. |
| Assignment preview creates an issue | `dry_run` guards alert assignments, not the separate missing-owner issue output. |
| A run succeeds but some writes are missing | Inspect warning logs and failed/skipped rows. Individual write failures can be recorded without failing the whole run. |
| No scheduled runs | The workflow must be on the default branch, and scheduled workflows are disabled after 60 days without repository activity. Use **Run workflow** to start it manually. |
