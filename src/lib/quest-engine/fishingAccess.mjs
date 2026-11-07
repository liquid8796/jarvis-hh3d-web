/**
 * Câu Cá requires an admin role or VIP tag. Never rely on the disabled
 * checkbox: persisted configs and worker snapshots must be checked too.
 */
export function enforceFishingAccessPolicy(config, canFish) {
  if (canFish === true || config.quests?.cauCa?.enabled !== true) return config;
  return {
    ...config,
    quests: {
      ...config.quests,
      cauCa: { ...config.quests.cauCa, enabled: false },
    },
  };
}

/**
 * The server sends this capability on claim and refreshes it on heartbeat.
 * Keep checking its deadline locally so a long fishing loop cannot outlive
 * its VIP tag just because the network is down. Missing fields from older
 * servers preserve the existing capability, rather than granting it again.
 */
export function createFishingAccessGate(initial, now = Date.now) {
  let current = initial === undefined ? { allowed: true, expiresAt: null } : initial;
  return {
    update(next) { if (next !== undefined) current = next; },
    canFish() {
      if (!current || !Object.hasOwn(current, "allowed") || current.allowed !== true) return false;
      if (current.expiresAt === null) return true;
      if (typeof current.expiresAt !== "string") return false;
      const deadline = Date.parse(current.expiresAt);
      return Number.isFinite(deadline) && deadline > now();
    },
  };
}
