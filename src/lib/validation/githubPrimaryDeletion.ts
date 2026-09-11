/** Stable client/server description of the primary rows covered by one confirmation dialog. */
export function githubPrimaryOwnerGroupFingerprint(
  stations: readonly { owner: string; repo: string; githubId?: number }[],
  owner: string,
): string {
  return stations
    .filter((station) => station.owner.toLowerCase() === owner.toLowerCase())
    .map((station) => `${station.owner}/${station.repo}#${station.githubId ?? "?"}`.toLowerCase())
    .sort()
    .join("\n");
}
