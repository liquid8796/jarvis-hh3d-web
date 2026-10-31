import React, { startTransition, useActionState, useState } from "react";
import { createRoot } from "react-dom/client";

declare global {
  interface Window {
    __configTestSubmissions: Array<Record<string,string>>;
  }
}
window.__configTestSubmissions = [];
function Example() {
  const [flag,setFlag] = useState(false);
  const [status,action,pending] = useActionState(async (_prev: {ok:boolean}|null,fd: FormData) => {
    const values = Object.fromEntries(fd.entries());
    window.__configTestSubmissions.push(values as Record<string,string>);
    await new Promise(resolve => setTimeout(resolve,30));
    return {ok: true};
  }, null);
  return (
    <form action={action} noValidate onSubmit={(event) => {
      event.preventDefault();
      const values = new FormData(event.currentTarget);
      startTransition(() => { action(values); });
    }}>
      <input type="number" name="vipTier" defaultValue={2} />
      <input type="checkbox" name="freeEnabled" defaultChecked={false} />
      <div hidden><input type="number" name="hiddenFreeCap" defaultValue={4} /></div>
      <input type="checkbox" checked={flag} onChange={e => setFlag(e.target.checked)} />
      {flag && <input type="hidden" name="q_diemDanh" value="on" />}
      <button type="submit" disabled={pending}>{pending ? "Saving" : "Save"}</button>
      {status && <span role="status">{status.ok ? "SAVED" : "FAILED"}</span>}
    </form>
  );
}
createRoot(document.getElementById("root")!).render(<Example />);
