import { Octokit } from 'octokit';
import { inflateRawSync } from 'node:zlib';
import type {
  GitHubClient,
  RepoRef,
  PrMeta,
  PrDetail,
  PrStatus,
  GitHubReviewPayload,
  CreateReviewCommentInput,
  PrReviewComment,
  OpenPrPayload,
  CommitFilesPayload,
  IssueMeta,
  WorkflowRunSummary,
} from '@devdigest/shared';
import { withRetry, withTimeout } from '../../platform/resilience.js';

const TIMEOUT = 30_000;

function mapStatus(state: string, merged: boolean | undefined): PrStatus {
  if (merged) return 'merged';
  if (state === 'closed') return 'closed';
  return 'open';
}

/**
 * Minimal, dependency-free ZIP reader for one GitHub Actions artifact
 * (SPEC-08 T5/AC-23) — extracts the FIRST file entry and `JSON.parse`s it.
 * `agent-runner`'s `actions/upload-artifact` step always packages exactly
 * one file (`devdigest-result.json`) per artifact, so "first entry" is
 * sufficient; this intentionally does not support multi-file zips.
 *
 * Written by hand rather than adding a zip-reading dependency (`yauzl`/
 * `adm-zip`/…) — none is installed in `server/`, and adding one needs a
 * network `pnpm add` + lockfile edit unavailable without `Bash` (same class
 * of constraint as the `yaml`-dependency gotcha recorded in root
 * `INSIGHTS.md`, 2026-08-22). Supports the two compression methods GitHub's
 * own zip producer uses: 0 (stored) and 8 (deflate). Throws on anything
 * else — a genuinely malformed/unexpected artifact is the caller's job to
 * catch-and-skip (AC-25's "invalid → skip, log warning, zero writes"), not
 * this function's job to silently swallow into `null` (`null` here is
 * reserved for "no artifact by that name at all", AC-23).
 *
 * Does NOT handle ZIP64 (the extended central-directory/EOCD format for
 * archives with 65535+ entries or any entry/archive over 4GB) — a
 * deliberate scope limit, not an oversight (flagged by `plan-verifier`,
 * evaluated here): the one artifact this ever reads is a single JSON file
 * (`devdigest-result.json`, a findings summary — kilobytes, never
 * megabytes) inside a single-entry zip `agent-runner`'s own
 * `actions/upload-artifact` step produces. Both ZIP64 triggers are
 * unreachable for this artifact by construction; adding ZIP64 support would
 * be real effort spent on a size class this reader will never see.
 */
function extractFirstZipEntryAsJson(zip: Buffer): unknown {
  const EOCD_SIGNATURE = 0x06054b50;
  const CENTRAL_DIR_SIGNATURE = 0x02014b50;

  let eocdOffset = -1;
  for (let i = zip.length - 22; i >= 0; i--) {
    if (zip.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error('devdigest-result artifact: not a valid zip (no End Of Central Directory record)');
  }

  const totalEntries = zip.readUInt16LE(eocdOffset + 10);
  if (totalEntries === 0) throw new Error('devdigest-result artifact: zip has no entries');
  const centralDirOffset = zip.readUInt32LE(eocdOffset + 16);

  const sig = zip.readUInt32LE(centralDirOffset);
  if (sig !== CENTRAL_DIR_SIGNATURE) {
    throw new Error('devdigest-result artifact: malformed central directory header');
  }

  const compressionMethod = zip.readUInt16LE(centralDirOffset + 10);
  const compressedSize = zip.readUInt32LE(centralDirOffset + 20);
  // (fileNameLength at +28 would be needed to locate the NEXT central-dir
  // entry — unused here since we only ever read the first.)
  const localHeaderOffset = zip.readUInt32LE(centralDirOffset + 42);

  const lfhFileNameLength = zip.readUInt16LE(localHeaderOffset + 26);
  const lfhExtraLength = zip.readUInt16LE(localHeaderOffset + 28);
  const dataStart = localHeaderOffset + 30 + lfhFileNameLength + lfhExtraLength;
  const compressed = zip.subarray(dataStart, dataStart + compressedSize);

  let raw: Buffer;
  if (compressionMethod === 0) raw = Buffer.from(compressed);
  else if (compressionMethod === 8) raw = inflateRawSync(compressed);
  else throw new Error(`devdigest-result artifact: unsupported zip compression method ${compressionMethod}`);

  return JSON.parse(raw.toString('utf8'));
}

/**
 * GitHubClient over Octokit REST — thin. PAT auth (fine-grained).
 * Reads PR list/detail/files/commits/issue; posts reviews; opens PRs.
 */
export class OctokitGitHubClient implements GitHubClient {
  private octokit: Octokit;

  constructor(token: string) {
    this.octokit = new Octokit({ auth: token });
  }

  async listPullRequests(repo: RepoRef): Promise<PrMeta[]> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          // Fetch open + recently merged/closed (most-recently-updated first) so
          // the list shows which PRs are merged vs still open — not just open.
          const res = await this.octokit.rest.pulls.list({
            owner: repo.owner,
            repo: repo.name,
            state: 'all',
            sort: 'updated',
            direction: 'desc',
            per_page: 50,
          });
          return res.data.map((pr) => ({
            number: pr.number,
            title: pr.title,
            author: pr.user?.login ?? 'unknown',
            branch: pr.head.ref,
            base: pr.base.ref,
            head_sha: pr.head.sha,
            additions: 0,
            deletions: 0,
            files_count: 0, // not present on the list payload; populated by getPullRequest
            status: mapStatus(pr.state, Boolean(pr.merged_at)) as PrStatus,
            opened_at: pr.created_at,
            updated_at: pr.updated_at,
          }));
        })(),
        TIMEOUT,
      ),
    );
  }

  async getPullRequest(repo: RepoRef, n: number): Promise<PrDetail> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const { data: pr } = await this.octokit.rest.pulls.get({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
          });
          const { data: files } = await this.octokit.rest.pulls.listFiles({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
            per_page: 100,
          });
          const { data: commits } = await this.octokit.rest.pulls.listCommits({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
            per_page: 100,
          });
          const linkedIssue = await this.resolveLinkedIssue(repo, pr.body ?? '');
          return {
            number: pr.number,
            title: pr.title,
            author: pr.user?.login ?? 'unknown',
            branch: pr.head.ref,
            base: pr.base.ref,
            head_sha: pr.head.sha,
            additions: pr.additions,
            deletions: pr.deletions,
            files_count: pr.changed_files,
            status: mapStatus(pr.state, Boolean(pr.merged_at)) as PrStatus,
            opened_at: pr.created_at,
            updated_at: pr.updated_at,
            body: pr.body,
            files: files.map((f) => ({
              path: f.filename,
              additions: f.additions,
              deletions: f.deletions,
              patch: f.patch,
            })),
            commits: commits.map((c) => ({
              sha: c.sha,
              message: c.commit.message,
              author: c.commit.author?.name ?? c.author?.login ?? 'unknown',
              committed_at: c.commit.author?.date,
            })),
            linked_issue: linkedIssue,
          };
        })(),
        TIMEOUT,
      ),
    );
  }

  /** linked issue via regex on PR body (#123 / closes #123). */
  private async resolveLinkedIssue(repo: RepoRef, body: string): Promise<IssueMeta | undefined> {
    const m = body.match(/(?:closes|fixes|resolves)?\s*#(\d+)/i);
    if (!m?.[1]) return undefined;
    try {
      return await this.getIssue(repo, Number(m[1]));
    } catch {
      return undefined;
    }
  }

  async postReview(
    repo: RepoRef,
    n: number,
    review: GitHubReviewPayload,
  ): Promise<{ id: string }> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const res = await this.octokit.rest.pulls.createReview({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
            body: review.body,
            event: review.event,
            comments: review.comments?.map((c) => ({
              path: c.path,
              line: c.line,
              body: c.body,
            })),
          });
          return { id: String(res.data.id) };
        })(),
        TIMEOUT,
      ),
    );
  }

  /** Shape an Octokit review-comment payload into our DTO. */
  private mapReviewComment(c: {
    id: number;
    path: string;
    line?: number | null;
    original_line?: number | null;
    side?: string | null;
    body: string;
    user: { login: string } | null;
    created_at: string;
    html_url: string;
    in_reply_to_id?: number;
  }): PrReviewComment {
    return {
      id: c.id,
      path: c.path,
      line: c.line ?? null,
      original_line: c.original_line ?? null,
      side: c.side === 'LEFT' ? 'LEFT' : 'RIGHT',
      body: c.body,
      user: c.user?.login ?? 'unknown',
      created_at: c.created_at,
      html_url: c.html_url,
      in_reply_to_id: c.in_reply_to_id ?? null,
      // GitHub drops `line` when the comment can no longer be placed on the diff.
      is_outdated: c.line == null,
    };
  }

  async listReviewComments(repo: RepoRef, n: number): Promise<PrReviewComment[]> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const res = await this.octokit.rest.pulls.listReviewComments({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
            per_page: 100,
          });
          return res.data.map((c) => this.mapReviewComment(c));
        })(),
        TIMEOUT,
      ),
    );
  }

  async createReviewComment(
    repo: RepoRef,
    n: number,
    input: CreateReviewCommentInput,
  ): Promise<PrReviewComment> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          if (input.inReplyTo != null) {
            const res = await this.octokit.rest.pulls.createReplyForReviewComment({
              owner: repo.owner,
              repo: repo.name,
              pull_number: n,
              comment_id: input.inReplyTo,
              body: input.body,
            });
            return this.mapReviewComment(res.data);
          }
          const res = await this.octokit.rest.pulls.createReviewComment({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
            commit_id: input.commitId,
            path: input.path,
            line: input.line,
            side: input.side ?? 'RIGHT',
            body: input.body,
          });
          return this.mapReviewComment(res.data);
        })(),
        TIMEOUT,
      ),
    );
  }

  async openPullRequest(repo: RepoRef, payload: OpenPrPayload): Promise<{ url: string }> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const res = await this.octokit.rest.pulls.create({
            owner: repo.owner,
            repo: repo.name,
            title: payload.title,
            head: payload.head,
            base: payload.base,
            body: payload.body,
          });
          return { url: res.data.html_url };
        })(),
        TIMEOUT,
      ),
    );
  }

  async commitFiles(
    repo: RepoRef,
    payload: CommitFilesPayload,
  ): Promise<{ branch: string }> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const owner = repo.owner;
          const name = repo.name;
          const g = this.octokit.rest.git;

          // Parent commit: the target branch if it already exists, else the base.
          let parentSha: string;
          let branchExists = false;
          try {
            const ref = await g.getRef({ owner, repo: name, ref: `heads/${payload.branch}` });
            parentSha = ref.data.object.sha;
            branchExists = true;
          } catch {
            const baseRef = await g.getRef({ owner, repo: name, ref: `heads/${payload.base}` });
            parentSha = baseRef.data.object.sha;
          }

          // New tree layered on the parent's tree (so unrelated files are kept).
          const parentCommit = await g.getCommit({ owner, repo: name, commit_sha: parentSha });
          const tree = await g.createTree({
            owner,
            repo: name,
            base_tree: parentCommit.data.tree.sha,
            tree: payload.files.map((f) => ({
              path: f.path,
              mode: '100644',
              type: 'blob',
              content: f.contents,
            })),
          });

          const commit = await g.createCommit({
            owner,
            repo: name,
            message: payload.message,
            tree: tree.data.sha,
            parents: [parentSha],
          });

          if (branchExists) {
            await g.updateRef({
              owner,
              repo: name,
              ref: `heads/${payload.branch}`,
              sha: commit.data.sha,
              force: true,
            });
          } else {
            await g.createRef({
              owner,
              repo: name,
              ref: `refs/heads/${payload.branch}`,
              sha: commit.data.sha,
            });
          }
          return { branch: payload.branch };
        })(),
        TIMEOUT,
      ),
    );
  }

  async findOpenPr(repo: RepoRef, branch: string): Promise<{ url: string } | null> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const res = await this.octokit.rest.pulls.list({
            owner: repo.owner,
            repo: repo.name,
            state: 'open',
            head: `${repo.owner}:${branch}`,
            per_page: 1,
          });
          const pr = res.data[0];
          return pr ? { url: pr.html_url } : null;
        })(),
        TIMEOUT,
      ),
    );
  }

  async getIssue(repo: RepoRef, n: number): Promise<IssueMeta> {
    const res = await withRetry(() =>
      withTimeout(
        this.octokit.rest.issues.get({ owner: repo.owner, repo: repo.name, issue_number: n }),
        TIMEOUT,
      ),
    );
    return {
      number: res.data.number,
      title: res.data.title,
      body: res.data.body,
      state: res.data.state,
    };
  }

  async currentLogin(): Promise<string> {
    const res = await withRetry(() =>
      withTimeout(this.octokit.rest.users.getAuthenticated(), TIMEOUT),
    );
    return res.data.login;
  }

  async listWorkflowRunsFor(repo: RepoRef, workflowFile: string): Promise<WorkflowRunSummary[]> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const res = await this.octokit.rest.actions.listWorkflowRuns({
            owner: repo.owner,
            repo: repo.name,
            workflow_id: workflowFile,
            per_page: 50,
          });
          return res.data.workflow_runs.map((run) => ({
            runId: run.id,
            headSha: run.head_sha,
            status: run.status ?? 'unknown',
            htmlUrl: run.html_url,
            ranAt: run.run_started_at ?? run.created_at,
          }));
        })(),
        TIMEOUT,
      ),
    );
  }

  async downloadRunArtifact(
    repo: RepoRef,
    runId: number,
    artifactName: string,
  ): Promise<unknown | null> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const list = await this.octokit.rest.actions.listWorkflowRunArtifacts({
            owner: repo.owner,
            repo: repo.name,
            run_id: runId,
            per_page: 100,
          });
          const artifact = list.data.artifacts.find((a) => a.name === artifactName);
          if (!artifact) return null; // AC-23: no artifact by that name — best-effort, not an error.

          const download = await this.octokit.rest.actions.downloadArtifact({
            owner: repo.owner,
            repo: repo.name,
            artifact_id: artifact.id,
            archive_format: 'zip',
          });
          // `downloadArtifact` follows GitHub's 302 redirect to the actual zip
          // bytes; the response body isn't JSON, so Octokit hands it back as
          // a raw ArrayBuffer rather than parsing it.
          const zipBuffer = Buffer.from(download.data as unknown as ArrayBuffer);
          return extractFirstZipEntryAsJson(zipBuffer);
        })(),
        TIMEOUT,
      ),
    );
  }
}
