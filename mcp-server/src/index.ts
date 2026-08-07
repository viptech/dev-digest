#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createListAgentsTool } from './tools/list-agents.js';
import { createListPullsTool } from './tools/list-pulls.js';
import { createGetConventionsTool } from './tools/get-conventions.js';
import { createGetFindingsTool } from './tools/get-findings.js';
import { createGetBlastRadiusTool } from './tools/get-blast-radius.js';
import { createRunAgentOnPrTool } from './tools/run-agent-on-pr.js';

/**
 * devdigest-mcp — local stdio MCP server exposing 6 tools over the DevDigest
 * API (server/, port 3001, no auth locally). See README.md for how to wire
 * this into Claude Code/Desktop. `list_pulls` is a lab extension beyond the
 * course's 5 (README.md's own note there against a `list_prs` tool is about
 * NOT duplicating `gh`/GitHub MCP's PR listing — but neither knows
 * DevDigest's internal `pr_id`, which every other tool here requires; see
 * list-pulls.ts's doc comment).
 */

const server = new McpServer({
  name: 'devdigest-mcp',
  version: '0.1.0',
});

// Order mirrors the plan's implementation order (simplest → composes-everything).
// Registered as separate calls, not looped over a heterogeneous array — each
// tool's config/handler types differ (distinct input/output Zod shapes), and
// widening them into one array's element type breaks registerTool's generic
// inference (TS2345 at the call site) even though each is individually valid.
const listAgentsTool = createListAgentsTool();
server.registerTool(listAgentsTool.name, listAgentsTool.config, listAgentsTool.handler);

const listPullsTool = createListPullsTool();
server.registerTool(listPullsTool.name, listPullsTool.config, listPullsTool.handler);

const getConventionsTool = createGetConventionsTool();
server.registerTool(getConventionsTool.name, getConventionsTool.config, getConventionsTool.handler);

const getFindingsTool = createGetFindingsTool();
server.registerTool(getFindingsTool.name, getFindingsTool.config, getFindingsTool.handler);

const getBlastRadiusTool = createGetBlastRadiusTool();
server.registerTool(getBlastRadiusTool.name, getBlastRadiusTool.config, getBlastRadiusTool.handler);

const runAgentOnPrTool = createRunAgentOnPrTool();
server.registerTool(runAgentOnPrTool.name, runAgentOnPrTool.config, runAgentOnPrTool.handler);

const transport = new StdioServerTransport();
await server.connect(transport);
