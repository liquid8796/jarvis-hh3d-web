/**
 * On-demand GitHub Actions dispatch: unlike autoscaling, an old queued run is
 * NOT a reason to refuse a manual run. Never return the PAT to the browser.
 */
export type ManualWorkflowStation = {
  owner: string; repo: string; workflowFile: string; purpose: "worker" | "adViewer";
  enabled: boolean; primaryDeferred: boolean;
};
export type ManualWorkflowResult = {
  ok: boolean; message: string; runUrl?: string; runId?: number;
};
type GithubRun = { id: number; status: string; event: string; created_at: string };
type GithubResponse = {
  state?: string; default_branch?: string; workflow_runs?: GithubRun[];
};
export type ManualDispatchDependencies = {
  fetcher?: typeof fetch;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
};
export async function dispatchGithubWorkflowManually(
  station: ManualWorkflowStation,
  pat: string,
  deps: ManualDispatchDependencies = {},
): Promise<ManualWorkflowResult> {
  const slug = station.owner + "/" + station.repo;
  const rejected = (message: string): ManualWorkflowResult => ({ ok: false, message });
  if (!station.enabled || station.primaryDeferred || station.purpose !== "worker") {
    return rejected("Kho này chưa được kích hoạt để chạy Khôi Lỗi GitHub.");
  }
  if (!station.workflowFile || !/^[A-Za-z0-9._-]+\.ya?ml$/.test(station.workflowFile)) {
    return rejected("Tên workflow chưa hợp lệ.");
  }
  const request = deps.fetcher ?? fetch;
  const now = deps.now ?? Date.now;
  const wait = deps.wait ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const root = "https://api.github.com/repos/" + encodeURIComponent(station.owner) + "/" + encodeURIComponent(station.repo);
  const workflow = root + "/actions/workflows/" + encodeURIComponent(station.workflowFile);
  const headers = {
    authorization: "Bearer " + pat,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "auto-hh3d-manual-worker-dispatch",
  };
  async function get(url: string): Promise<GithubResponse> {
    const response = await request(url, { headers, cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw Error("GitHub HTTP " + response.status + " khi kiểm tra workflow.");
    return await response.json() as GithubResponse;
  }
  try {
    const [status, repository, runs] = await Promise.all([
      get(workflow), get(root), get(workflow + "/runs?per_page=10"),
    ]);
    if (status.state !== "active") return rejected("Workflow " + slug + " đang ở trạng thái " + (status.state ?? "không xác định") + ". Hãy bật workflow trước.");
    const branch = repository.default_branch;
    if (!branch || !/^[A-Za-z0-9._/-]+$/.test(branch)) {
      return rejected("GitHub không trả về default branch hợp lệ cho " + slug + ".");
    }
    if (!Array.isArray(runs.workflow_runs)) return rejected("Không đọc được danh sách lượt GitHub Actions; không gửi lệnh mù.");
    const active = runs.workflow_runs.some(run => ["in_progress", "waiting", "requested", "pending"].includes(run.status));
    if (active) return rejected("Kho " + slug + " đang có một lượt chạy; không tạo lượt trùng.");
    // Manual click may bypass a multi-hour GitHub queue, but not its own recent
    // dispatch: a 60s window protects against double-clicks and stale UI reloads.
    const recentQueued = runs.workflow_runs.some(run => run.status === "queued" &&
      Number.isFinite(Date.parse(run.created_at)) &&
      now() - Date.parse(run.created_at) >= 0 &&
      now() - Date.parse(run.created_at) < 60_000);
    if (recentQueued) return rejected("Kho vừa được yêu cầu chạy trong vòng 60 giây. Kiểm tra GitHub Actions trước khi bấm lại.");
    const ids = new Set(runs.workflow_runs.map(run => run.id));
    const accepted = await request(workflow + "/dispatches", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ ref: branch }),
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (accepted.status !== 204) {
      return rejected("GitHub từ chối Run workflow của " + slug + " (HTTP " + accepted.status + ").");
    }
    // GitHub returns HTTP 204, not run_id. Visibility may lag a few seconds.
    // Never falsely claim a runner is online or fabricate a run ID.
    const fallbackUrl = "https://github.com/" + station.owner + "/" + station.repo +
      "/actions/workflows/" + encodeURIComponent(station.workflowFile);
    let next: GithubResponse | undefined;
    try {
      await wait(1000);
      next = await get(workflow + "/runs?per_page=10");
    } catch { /* Dispatch already accepted; let user open the Actions page. */ }
    const found = next?.workflow_runs?.find(run => !ids.has(run.id) && run.event === "workflow_dispatch");
    if (found) {
      return {
        ok: true,
        message: "GitHub đã nhận Run workflow cho " + slug + ". Run #" + found.id + " đang " + found.status + ".",
        runId: found.id,
        runUrl: "https://github.com/" + station.owner + "/" + station.repo + "/actions/runs/" + found.id,
      };
    }
    return {
      ok: true,
      message: "GitHub đã nhận Run workflow cho " + slug + " (HTTP 204). Run ID chưa xuất hiện; xem Actions để theo dõi.",
      runUrl: fallbackUrl,
    };
  } catch (error) {
    // Error text is purposely sanitized: do not log or return PAT/request headers.
    const detail = error instanceof Error ? error.message : "Lỗi mạng không xác định";
    return rejected("Không chạy được " + slug + ": " +
      (/^GitHub HTTP \d{3}/.test(detail) ? detail : "lỗi kết nối GitHub; thử lại sau."));
  }
}

/**
 * Enable/disable only the workflow definition. Never cancel an existing run:
 * workers already alive finish their current tasks via cooperative drain.
 */
export async function setGithubWorkflowEnabledManually(
  station: ManualWorkflowStation,
  pat: string,
  enabled: boolean,
  request: typeof fetch = fetch,
): Promise<ManualWorkflowResult> {
  const slug = station.owner + "/" + station.repo;
  if (!station.enabled || station.primaryDeferred || station.purpose !== "worker") {
    return { ok: false, message: "Kho chính chưa được kích hoạt để điều khiển workflow." };
  }
  if (!/^[A-Za-z0-9._-]+\.ya?ml$/.test(station.workflowFile)) {
    return { ok: false, message: "Tên workflow chưa hợp lệ." };
  }
  const endpoint = "https://api.github.com/repos/" + encodeURIComponent(station.owner) +
    "/" + encodeURIComponent(station.repo) + "/actions/workflows/" +
    encodeURIComponent(station.workflowFile);
  const headers = {
    authorization: "Bearer " + pat,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "auto-hh3d-admin-workflow-switch",
  };
  try {
    const status = await request(endpoint, {
      headers, cache: "no-store", signal: AbortSignal.timeout(10000),
    });
    if (!status.ok) return { ok: false, message: "Không đọc được workflow GitHub (HTTP " + status.status + ")." };
    const value = await status.json() as { state?: string };
    if (!["active", "disabled_manually", "disabled_inactivity"].includes(value.state ?? "")) {
      return { ok: false, message: "Workflow có trạng thái không hỗ trợ: " + (value.state ?? "không rõ") };
    }
    const already = enabled ? value.state === "active" : value.state !== "active";
    if (!already) {
      const update = await request(endpoint + (enabled ? "/enable" : "/disable"), {
        method: "PUT", headers, cache: "no-store", signal: AbortSignal.timeout(12000),
      });
      if (update.status !== 204) {
        return { ok: false, message: "GitHub từ chối " + (enabled ? "bật" : "tắt") + " workflow (HTTP " + update.status + ")." };
      }
    }
    return { ok: true, message: enabled
      ? "Đã bật lại workflow " + slug + " trên GitHub; Auto Scaling có thể điều chỉnh theo nhu cầu."
      : "Đã tắt workflow " + slug + " trên GitHub và tạm dừng Auto Scaling cho kho này. Runner đang chạy không bị hủy." };
  } catch {
    return { ok: false, message: "Không kết nối được GitHub; chưa xác nhận thay đổi workflow." };
  }
}
