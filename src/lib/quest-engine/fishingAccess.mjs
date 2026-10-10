/**
 * Câu Cá is an experimental admin-only feature. Never rely on the disabled
 * checkbox: persisted configs and worker snapshots must be checked too.
 */
export function enforceFishingAdminPolicy(config, isAdmin) {
  if (isAdmin || config.quests?.cauCa?.enabled !== true) return config;
  return {
    ...config,
    quests: {
      ...config.quests,
      cauCa: { ...config.quests.cauCa, enabled: false },
    },
  };
}
