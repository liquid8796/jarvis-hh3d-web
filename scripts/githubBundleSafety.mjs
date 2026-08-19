/** Pure safety rules shared by the two GitHub bundle creation entry points. */

export const REQUIRED_BUNDLE_PAT_SCOPES = Object.freeze(["repo", "workflow", "delete_repo"]);

/** Extract the classic-token scope header from `gh api --include user` output. */
export function oauthScopesFromGhApiOutput(output) {
  const match = /^x-oauth-scopes:\s*(.*)$/im.exec(String(output));
  return match ? match[1].trim() : null;
}

/**
 * A bundle is allowed to mutate GitHub only when rollback permission is provable up front.
 *
 * Fine-grained tokens do not expose granted permissions in `X-OAuth-Scopes`. Although one with
 * Administration: write may be able to delete, creation cannot prove that before the new repos
 * exist. Fail closed: the atomic three-repo creator accepts a classic PAT with explicit scopes.
 */
export function reviewBundlePatScopes(rawScopes) {
  if (typeof rawScopes !== "string" || rawScopes.trim().length === 0) {
    return {
      ok: false,
      missing: [...REQUIRED_BUNDLE_PAT_SCOPES],
      message:
        "Không chứng minh được quyền rollback của PAT. Lượt dựng bundle cần token classic " +
        "với repo + workflow + delete_repo; token fine-grained không công bố đủ quyền trước khi repo tồn tại.",
    };
  }
  const granted = new Set(rawScopes.split(",").map((scope) => scope.trim()).filter(Boolean));
  const missing = REQUIRED_BUNDLE_PAT_SCOPES.filter((scope) => !granted.has(scope));
  return {
    ok: missing.length === 0,
    missing,
    message: missing.length === 0
      ? ""
      : `PAT thiếu scope bắt buộc cho bundle: ${missing.join(", ")}. ` +
        "Cần repo + workflow để dựng/chạy và delete_repo để rollback an toàn trước mọi mutation.",
  };
}

/**
 * A failed read proves absence only when GitHub explicitly says the repository was not found.
 * Authentication, authorization, CLI, and network failures all remain unknown and fail closed.
 */
export function repoProbeResultFromFailure(output) {
  const text = String(output ?? "");
  if (/\bhttp(?:\/[\d.]+)?\s+404\b/i.test(text) || /could not resolve to (?:a )?repository/i.test(text)) {
    return "no";
  }
  return "unknown";
}

/**
 * Enforce the only safe ownership boundary for a non-idempotent repository create call.
 *
 * `remember` runs strictly after `create` returns success and strictly before `push`. Therefore:
 * - an ambiguous create error never becomes a cleanup target;
 * - a later push/secret error can safely roll back the confirmed repository.
 */
export function publishConfirmedRepository({ repository, create, remember, push }) {
  create(repository);
  remember(repository.slug);
  push(repository);
}
