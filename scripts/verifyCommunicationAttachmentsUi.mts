import assert from "node:assert/strict";
import { build } from "esbuild";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";

// Real components and browser events, with HTTP fixtures. No production messages or uploads.
const built = await build({
  stdin: {
    contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
      import {DirectThread} from './src/components/communication/DirectThread';
      import {RoomPanel} from './src/components/communication/RoomPanel';
      const noop = () => {}; const peer = {id:'peer',displayName:'SOUP',username:'soup',avatarUrl:null,isAdmin:false,presence:'offline',selectedPresence:'offline'};
      const room = location.hash === '#room';
      createRoot(document.getElementById('root')).render(<section className="communication-panel">{room ? <RoomPanel meId="me" unread={0} onChanged={noop}/> : <DirectThread meId="me" peer={peer} onBack={noop} onRead={noop} onChanged={noop}/>}</section>);`,
    loader: "tsx", resolveDir: process.cwd(),
  },
  bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
});
const css = await readFile("src/app/communication.css", "utf8");
const server = createServer((request, response) => {
  if (request.url === "/app.js") { response.setHeader("content-type", "text/javascript"); response.end(built.outputFiles[0].text); return; }
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.end(`<style>*{box-sizing:border-box}body{margin:0;background:#090b18;color:white;font-family:Arial;--color-gold-300:#e9c45a;--color-parchment:#eee}button,input{font:inherit}input{background:#101221;color:white;border:1px solid #333;border-radius:8px}${css}.communication-panel{position:relative;bottom:auto;margin:8px;width:368px;max-width:calc(100vw - 16px);height:570px}</style><div id="root"></div><script src="/app.js"></script>`);
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 390, height: 700 } });
let uploads = 0;
let failUpload = false;
let failSend = false;
let uploadDelay = 0;
const browserErrors: string[] = [];
page.on("pageerror", (error) => browserErrors.push(error.message));
const sent: Array<Record<string, unknown>> = [];
const messages: Array<Record<string, unknown>> = [];
await page.route("**/api/**", async (route) => {
  const request = route.request();
  const pathname = new URL(request.url()).pathname;
  if (pathname === "/api/chat/upload" || (pathname === "/api/direct-messages/files" && request.method() === "POST")) {
    uploads++;
    if (uploadDelay) await new Promise((resolve) => setTimeout(resolve, uploadDelay));
    if (failUpload) return route.fulfill({status:503,json:{error:"Tải file thất bại."}});
    const name = request.postDataBuffer()?.toString().match(/filename="([^"]+)"/)?.[1] ?? "file.txt";
    return route.fulfill({json:{url: pathname === "/api/direct-messages/files" ? `/api/direct-messages/files/00000000-0000-4000-8000-${String(uploads).padStart(12, "0")}` : `https://files.example/${uploads}`,name,size:4,type:name.endsWith('.png')?'image/png':'application/octet-stream'}});
  }
  if (request.method() === "POST") {
    const data = request.postDataJSON() as Record<string, unknown>;
    if (data.op === "read") return route.fulfill({json:{ok:true}});
    sent.push(data);
    if (failSend) return route.fulfill({status:400,json:{error:"Gửi tin thất bại."}});
    const body = (data.body ?? data) as Record<string, unknown>;
    messages.push({id:String(messages.length),senderId:'me',recipientId:'peer',senderName:'Me',userId:'me',author:'Me',text:body.text,attachments:body.attachments,createdAt:new Date().toISOString(),readAt:null});
    return route.fulfill({json:{ok:true}});
  }
  return route.fulfill({json:{messages,markedRead:0,typing:[],avatars:{}}});
});
const file = (name = "notes.txt", size = 4) => ({ name, mimeType: "text/plain", buffer: Buffer.alloc(size, 65) });
const waitFor = async (fn: () => Promise<boolean>) => {
  for (let i = 0; i < 100; i++) { if (await fn()) return; await page.waitForTimeout(50); }
  assert.fail("UI condition did not become true");
};
try {
  await page.goto(origin);
  const picker = page.locator('input[type="file"]');
  await page.waitForSelector('.communication-composer');
  assert.equal(await picker.count(), 1, "private composer exposes a file picker");
  const chooserEvent = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Đính kèm file", exact: true }).click();
  await (await chooserEvent).setFiles(file());
  await waitFor(async () => await page.getByRole('button',{name:'Gửi tin nhắn',exact:true}).isEnabled());
  await page.getByRole('button',{name:'Gửi tin nhắn',exact:true}).click();
  await waitFor(async () => sent.length === 1 && await page.getByRole('link',{name:/notes.txt/}).count() > 0);
  assert.equal(sent[0].text, "");
  assert.equal((sent[0].attachments as unknown[]).length, 1, "attachment-only messages sent");

  const sendButton = page.getByRole("button", { name: "Gửi tin nhắn", exact: true });
  const drop = async (name: string) => {
    const transfer = await page.evaluateHandle((name) => {
      const data = new DataTransfer();
      data.items.add(new File(["test"], name, { type: "text/plain" }));
      return data;
    }, name);
    const target = page.locator(".communication-conversation");
    await target.dispatchEvent("dragenter", { dataTransfer: transfer });
    assert.equal(await page.locator(".communication-drop-overlay").count(), 1);
    await target.dispatchEvent("dragover", { dataTransfer: transfer });
    await target.dispatchEvent("drop", { dataTransfer: transfer });
    await transfer.dispose();
  };
  uploadDelay = 400;
  await drop("dropped.txt");
  assert.ok(await sendButton.isDisabled(), "cannot send while uploading");
  assert.equal(await page.locator(".communication-drop-overlay").count(), 0);
  await waitFor(async () => await sendButton.isEnabled());
  uploadDelay = 0;
  await page.getByRole("button", { name: "Bỏ file dropped.txt", exact: true }).click();
  assert.equal(await page.locator(".communication-draft-files li").count(), 0);
  assert.ok(await sendButton.isDisabled());

  // Empty and oversize files never reach the network.
  const beforeInvalid = uploads;
  await picker.setInputFiles([file("empty.txt", 0), file("too-big.txt", 8 * 1024 * 1024 + 1)]);
  assert.match(await page.getByRole("alert").innerText(), /8 MB/);
  assert.equal(uploads, beforeInvalid);
  await picker.setInputFiles(Array.from({ length: 7 }, (_, index) => file(`file-${index}.txt`)));
  await waitFor(async () => await page.locator(".communication-draft-files li").count() === 6 && await sendButton.isEnabled());
  assert.match(await page.getByRole("alert").innerText(), /tối đa 6/);
  assert.ok(await page.getByRole("button", { name: "Đính kèm file", exact: true }).isDisabled());
  for (let index = 0; index < 6; index++) await page.getByRole("button", { name: `Bỏ file file-${index}.txt`, exact: true }).click();

  failUpload = true;
  await picker.setInputFiles(file("retry.txt"));
  await waitFor(async () => await page.getByRole("button", { name: "Thử lại retry.txt" }).count() === 1);
  assert.ok(await sendButton.isDisabled(), "failed file needs retry or removal");
  failUpload = false;
  await page.getByRole("button", { name: "Thử lại retry.txt" }).click();
  await waitFor(async () => await sendButton.isEnabled());
  await page.getByRole("textbox", { name: "Nhắn cho SOUP" }).fill("with a file");
  failSend = true;
  await sendButton.click();
  await waitFor(async () => (await page.getByRole("alert").innerText()).includes("Gửi tin thất bại"));
  assert.equal(await page.locator(".communication-draft-files li").count(), 1, "failed send retains draft");
  assert.equal(await page.getByRole("textbox", { name: "Nhắn cho SOUP" }).inputValue(), "with a file");
  failSend = false;
  await sendButton.click();
  await waitFor(async () => await page.locator(".communication-draft-files li").count() === 0);
  assert.equal(sent.at(-1)?.text, "with a file");

  // Re-selecting the same filename after removal works (input value is reset).
  await picker.setInputFiles(file("same.txt"));
  await waitFor(async () => await sendButton.isEnabled());
  await page.getByRole("button", { name: "Bỏ file same.txt", exact: true }).click();
  await picker.setInputFiles(file("same.txt"));
  await waitFor(async () => await sendButton.isEnabled());
  await picker.setInputFiles(file("image.png"));
  await waitFor(async () => await page.locator(".communication-draft-files img").count() === 1);
  await page.setViewportSize({ width: 320, height: 650 });
  const dimensions = await page.locator(".communication-composer").evaluate((element) => ({
    right: element.getBoundingClientRect().right,
    width: window.innerWidth,
    inputWidth: element.querySelector('input:not([type="file"])')?.getBoundingClientRect().width ?? 0,
  }));
  assert.ok(dimensions.right <= dimensions.width && dimensions.inputWidth > 80, "mobile composer fits");
  await page.screenshot({ path: ".tmp-watch/chat-attachments-mobile.png" });

  // Navigating away cancels the draft; room uses its own draft and the public send envelope.
  await page.goto(origin + "/room#room");
  assert.equal(await page.locator(".communication-draft-files li").count(), 0);
  await drop("room.txt");
  const roomSend = page.getByRole("button", { name: "Gửi lên sảnh", exact: true });
  await waitFor(async () => await roomSend.isEnabled());
  await roomSend.click();
  await waitFor(async () => Boolean((sent.at(-1)?.body as Record<string, unknown> | undefined)?.attachments));
  assert.equal(((sent.at(-1)?.body as Record<string, unknown>).attachments as unknown[]).length, 1);
  assert.deepEqual(browserErrors, []);
  console.log("OK: picker, external drop, attachment-only sends, previews, remove/reselect, 8 MB/six-file limits, upload retry, send failure, draft reset, room and mobile layout.");

} finally {
  await browser.close();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
