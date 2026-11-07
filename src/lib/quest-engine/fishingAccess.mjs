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
