# Jira alternative for security campaign operations

[Back to the README](../README.md)

Research reviewed: October 21, 2026.

## Feasibility

**This workflow can be adapted for Jira Cloud.** The recommended approach is to use
Atlassian's Jira MCP integration for reads and GitHub Agentic Workflows' Jira safe outputs
for writes. This preserves the current pattern: the agent analyzes information, while
separate controlled jobs perform mutations.

Both capabilities are documented in the released
[gh-aw v0.92.0](https://github.com/github/gh-aw/releases/tag/v0.92.0).
This is a documentation-based feasibility assessment, not an end-to-end Jira test or an
implemented Jira mode. The workflows in this repository still use GitHub Issues.

## What is already supported?

| Requirement | Supported approach |
| --- | --- |
| Find Jira work items associated with campaigns | Jira MCP reads, including JQL search |
| Read Jira work item details | Jira MCP `getJiraIssue` |
| Create a campaign report or missing-owner work item | `jira-create-issue` safe output |
| Update a report's summary or description | `jira-update-issue` safe output |
| Post campaign reminders | `jira-add-comment` safe output |
| Add tracking labels | `jira-add-label` safe output |
| Assign Jira work items, change statuses, or set custom fields | Additional implementation required; these are not supported by the built-in Jira safe outputs |

Although Atlassian's MCP server offers write tools, gh-aw's built-in `tools.jira`
integration permits a fixed **read-only** tool list. Writes should use Jira safe outputs
or custom validated jobs, not unrestricted MCP write access.

Sources:

- [GitHub: Jira MCP tools](https://github.github.com/gh-aw/reference/tools/#jira-tools-jira)
- [GitHub: Jira safe outputs](https://github.github.com/gh-aw/reference/safe-outputs/#jira-safe-outputs)
- [Atlassian: Supported MCP tools](https://support.atlassian.com/atlassian-rovo-mcp-server/docs/supported-tools/)

## The biggest change: removing GitHub Issues from discovery

This is **more than replacing GitHub comments with Jira comments**.

The current workflow searches GitHub issue titles to determine which repositories belong
to a campaign. Without those issues:

- Weekly summaries cannot discover repository-level details.
- Weekly reminders have no campaign issues to target.
- Owner assignment can fall back to organization-wide open-alert repositories, broadening
  its scope.

A Jira-only implementation therefore needs an explicit replacement for that mapping.
See the current [collection implementation](../.github/scripts/campaign-data.cjs) and the
README's [scope and limitations](../README.md#scope-and-limitations).

### Recommended mapping

Use Jira fields or a controlled mapping that connects:

| Mapping element | Example |
| --- | --- |
| GitHub organization | `YOUR-ORG` |
| GitHub campaign identifier | Campaign number or canonical URL |
| GitHub repository | `YOUR-ORG/service-a` |
| Jira work item | `SEC-123` |

Prefer stable identifiers and structured fields over title matching. This is an
architectural recommendation, not something the current workflow already implements.

A Jira mapping to repositories does **not** solve the existing alert-membership
limitation: the workflow currently processes repository-level alert sets, not an exact
campaign-alert inventory.

## How the adapted workflow would run

1. **Collect campaigns and alerts from GitHub.** Keep GitHub as the source of truth for
   campaign status, code scanning alerts and GitHub alert assignments.
2. **Resolve campaign/repository mappings to Jira work items.** Replace GitHub issue
   discovery with validated Jira mappings. Jira MCP can search and inspect work items;
   for deterministic collection, Jira REST calls in the collection job are another option.
3. **Assign eligible GitHub alerts.** Continue using the configured repository custom
   property. Moving follow-up to Jira does not require moving GitHub alert ownership.
4. **Analyze progress.** Give the agent the collected GitHub data and relevant Jira context.
5. **Post reminders to Jira.** Replace GitHub reminder comments with Jira safe outputs or
   a custom writer that validates the target project and work item against the trusted mapping.
6. **Publish reports in Jira.** Create a weekly report or update a standing report work
   item. Retain Actions summaries and artifacts if useful.
7. **Track duplicates and execution results.** Redesign the weekly reminder marker for
   Jira rather than assuming GitHub's HTML-comment marker will work unchanged.

For tighter validation, structured mentions, or behavior beyond the built-in outputs,
GitHub documents
[custom safe-output jobs for external APIs](https://github.github.com/gh-aw/reference/custom-safe-outputs/).

## Authentication for scheduled runs

Unattended authentication is supported. Atlassian documents API-token authentication
specifically for CI/CD pipelines, bots and other noninteractive scenarios.

For MCP reads, gh-aw documents:

```yaml
tools:
  jira:
    auth:
      type: api-token
      email: ${{ secrets.ATLASSIAN_EMAIL }}
      token: ${{ secrets.ATLASSIAN_API_TOKEN }}
    allowed:
      - getJiraIssue
      - searchJiraIssuesUsingJql
```

This is a documented configuration fragment, **not a complete replacement workflow**.
gh-aw also documents service-account API-key authentication for MCP reads.

An Atlassian administrator must enable the applicable authentication method. Token
permissions, Jira project permissions and IP allowlists still apply. Store credentials
in Actions secrets, not in committed workflow files.

Jira safe-output writes have their own documented configuration:
`JIRA_BASE_URL`, `JIRA_USER_EMAIL` and `JIRA_API_TOKEN` in the safe-output environment.
Do not assume a service-account credential configured for MCP reads automatically configures
the REST-based writers. Follow the write-side authentication and API-base instructions in
the Jira safe-output reference.

Sources:

- [GitHub: Jira MCP authentication configuration](https://github.github.com/gh-aw/reference/tools/#jira-tools-jira)
- [GitHub: Jira safe-output authentication configuration](https://github.github.com/gh-aw/reference/safe-outputs/#jira-safe-outputs)
- [Atlassian: Authentication and authorization](https://support.atlassian.com/atlassian-rovo-mcp-server/docs/authentication-and-authorization/)
- [Atlassian: Configure API-token authentication](https://support.atlassian.com/atlassian-rovo-mcp-server/docs/configuring-authentication-via-api-token/)
- [Atlassian: Administrator controls and IP restrictions](https://support.atlassian.com/security-and-access-policies/docs/control-atlassian-rovo-mcp-server-settings/)

## Important limitations and design decisions

### GitHub and Jira identities are different

A GitHub login cannot simply become a Jira assignee or mention. Jira mentions use
Atlassian account IDs and structured document nodes. Preserving actual mention
notifications would require identity mapping and likely a custom comment writer;
built-in Jira safe outputs convert plain strings to document text.

Sources:
[Jira mention format](https://developer.atlassian.com/cloud/jira/platform/apis/document/nodes/mention/),
[Jira safe-output behavior](https://github.github.com/gh-aw/reference/safe-outputs/#jira-safe-outputs).

### Closing previous weekly reports needs additional handling

Built-in Jira safe outputs do not support workflow transitions. Updating a standing
report is simpler than copying the current "create new report, close previous report"
behavior.

### Custom fields and Jira assignment need custom writes

MCP can help inspect Jira data, but the built-in safe-output write surface is deliberately
limited. Define and validate any custom write behavior rather than assuming every
Atlassian MCP capability is exposed by gh-aw.

Source:
[GitHub: Jira safe-output capabilities and limitations](https://github.github.com/gh-aw/reference/safe-outputs/#jira-safe-outputs).

### Version compatibility must be checked

The released gh-aw Jira documentation defaults to the `/v1/mcp` endpoint, while
Atlassian's current onboarding documentation presents `/v2/mcp`. Pin and test a compatible
combination rather than substituting endpoints blindly. Recompile workflow sources with
a compatible compiler before deploying changed workflows.

Sources:
[gh-aw v0.92.0 Jira tools reference](https://github.com/github/gh-aw/blob/v0.92.0/docs/src/content/docs/reference/tools.md#jira-tools-jira),
[Atlassian MCP setup](https://support.atlassian.com/atlassian-rovo-mcp-server/docs/getting-started-with-the-atlassian-remote-mcp-server/).

### Deployment and data-access boundaries still apply

This assessment covers **Jira Cloud**; it does not establish Jira Data Center compatibility.
Review the destination Jira project's access controls before copying security information.
Keep the execution repository private when its logs, summaries or artifacts contain
nonpublic security data, as described in the [README](../README.md#purpose-and-outcome).

## Recommended pilot

Start with a Jira Cloud pilot using:

- Explicit campaign/repository-to-Jira mappings.
- Read-only Jira MCP access for the agent.
- Validated Jira safe-output jobs for reminders and reporting.
- Existing GitHub alert assignment.
- Staged previews before enabling writes.

The Jira safe-output reference documents per-output `max` and `staged` settings. Use
appropriate operation limits and verify previews, target work items, identity mappings,
duplicate prevention and failure reporting before enabling scheduled writes.

**Bottom line:** Jira can replace GitHub Issues as the follow-up and reporting surface.
The principal work is replacing issue-based discovery, mapping identities, and preserving
safe, deduplicated writes, not merely connecting an MCP server.
