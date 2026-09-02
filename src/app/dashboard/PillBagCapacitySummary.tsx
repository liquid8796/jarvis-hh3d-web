import type { AccountTier, DashboardAccount } from "@/lib/realtime/dashboardTypes";

// Chốt múi giờ để server và trình duyệt luôn dựng cùng một nhãn thời gian.
const observedTimeFormat = new Intl.DateTimeFormat("vi-VN", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Asia/Ho_Chi_Minh",
});

/** Sức chứa là lần dò của từng tài khoản, không phải mặc định chung theo hạng VIP/Thường. */
export function PillBagCapacitySummary({
  accounts,
  accountTier,
}: {
  accounts: readonly DashboardAccount[];
  accountTier: AccountTier;
}) {
  const tierAccounts = accounts.filter((account) => account.accountTier === accountTier);
  const tierLabel = accountTier === "vip" ? "VIP" : "Thường";

  return (
    <div className="mt-2 text-xs text-[var(--color-mist)]">
      <p>So với đúng hàng phẩm đã chọn. Sức chứa theo từng tài khoản:</p>
      {tierAccounts.length === 0 ? (
        <p className="mt-1">Chưa có tài khoản được xác định là hạng {tierLabel}.</p>
      ) : (
        <>
          <ul className="mt-1 space-y-2" aria-label={`Sức chứa đan của tài khoản ${tierLabel}`}>
            {tierAccounts.map((account) => {
              const observedAt = account.pillBagCapsObservedAt
                ? new Date(account.pillBagCapsObservedAt)
                : null;
              const validObservedAt = observedAt && Number.isFinite(observedAt.getTime());

              return (
                <li
                  key={account.id}
                  className="rounded-md border border-[var(--color-ink-600)]/40 px-2 py-1.5 [overflow-wrap:anywhere]"
                >
                  <span className="font-medium text-[var(--color-parchment)]">{account.label}:</span>{" "}
                  {account.pillBagCaps ? (
                    <>
                      <span className="whitespace-nowrap">Hạ {account.pillBagCaps.ha}</span>{" · "}
                      <span className="whitespace-nowrap">Trung {account.pillBagCaps.trung}</span>{" · "}
                      <span className="whitespace-nowrap">Thượng {account.pillBagCaps.thuong}</span>{" · "}
                      <span className="whitespace-nowrap">Cực {account.pillBagCaps.cuc}</span>
                      <span className="mt-0.5 block">
                        {validObservedAt ? (
                          <>
                            Dò gần nhất:{" "}
                            <time dateTime={observedAt.toISOString()}>
                              {observedTimeFormat.format(observedAt)}
                            </time>.
                          </>
                        ) : (
                          "Chưa có thời điểm dò."
                        )}
                      </span>
                    </>
                  ) : (
                    <span>Chưa dò sức chứa.</span>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="mt-1">
            Tự cập nhật sau mỗi lượt Luyện Đan. Số đã dò có thể đã cũ nếu túi vừa được nâng.
          </p>
        </>
      )}
    </div>
  );
}
