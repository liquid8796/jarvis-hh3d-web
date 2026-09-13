/** Pure, injected reconciliation for the public GitHub About description. */

export type RepositoryMetadata = {
  id: number;
  fullName: string;
  defaultBranch: string;
  description: string | null;
};

export class GithubPrimaryDescriptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GithubPrimaryDescriptionError";
  }
}

export function parseRepositoryMetadata(value: unknown, slug: string): RepositoryMetadata {
  const info = value as {
    id?: unknown;
    full_name?: unknown;
    default_branch?: unknown;
    description?: unknown;
  } | null;
  if (
    !info ||
    typeof info.id !== "number" ||
    !Number.isSafeInteger(info.id) ||
    info.id <= 0 ||
    typeof info.full_name !== "string" ||
    info.full_name.toLowerCase() !== slug.toLowerCase() ||
    typeof info.default_branch !== "string" ||
    info.default_branch.length === 0 ||
    info.default_branch.length > 255 ||
    (info.description !== null && typeof info.description !== "string")
  ) {
    throw new GithubPrimaryDescriptionError(
      "GitHub trả danh tính hoặc About của kho không hợp lệ — không cập nhật mù.",
    );
  }
  return {
    id: info.id,
    fullName: info.full_name,
    defaultBranch: info.default_branch,
    description: info.description,
  };
}

function sameSnapshot(left: RepositoryMetadata, right: RepositoryMetadata): boolean {
  return left.id === right.id &&
    left.fullName.toLowerCase() === right.fullName.toLowerCase() &&
    left.defaultBranch === right.defaultBranch &&
    left.description === right.description;
}

/**
 * Re-read immediately before PATCH and verify twice after it. GitHub's repository-metadata
 * endpoint does not provide a compare-and-swap token here, so this detects intervening edits
 * observed by the last read; it does not claim an atomic lock across the network gap.
 */
export async function reconcilePublicDescription(input: {
  slug: string;
  before: RepositoryMetadata;
  description: string;
  read: () => Promise<unknown>;
  patch: (description: string) => Promise<unknown>;
}): Promise<void> {
  const { slug, before, description, read, patch } = input;
  if (
    typeof description !== "string" ||
    description.length === 0 ||
    description.length > 350 ||
    description.trim() !== description ||
    /[\r\n\u0000-\u001f\u007f]/u.test(description)
  ) {
    throw new GithubPrimaryDescriptionError("About mới không phải một dòng văn bản an toàn trong giới hạn GitHub.");
  }

  const fresh = parseRepositoryMetadata(await read(), slug);
  if (!sameSnapshot(fresh, before)) {
    throw new GithubPrimaryDescriptionError(
      "About hoặc danh tính kho đã đổi trong lúc lập kế hoạch — chạy lại để không ghi đè thay đổi vừa quan sát được.",
    );
  }

  const patched = parseRepositoryMetadata(await patch(description), slug);
  if (
    patched.id !== before.id ||
    patched.defaultBranch !== before.defaultBranch ||
    patched.description !== description
  ) {
    throw new GithubPrimaryDescriptionError(
      "GitHub nhận lệnh đổi About nhưng phản hồi không khớp nội dung mong đợi.",
    );
  }

  const verified = parseRepositoryMetadata(await read(), slug);
  if (
    verified.id !== before.id ||
    verified.defaultBranch !== before.defaultBranch ||
    verified.description !== description
  ) {
    throw new GithubPrimaryDescriptionError("About đọc lại không khớp sau khi cập nhật.");
  }
}
