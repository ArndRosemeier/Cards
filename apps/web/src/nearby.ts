// Nearby play (no server, WLAN or phone hotspot): the screens for swapping the two short codes.
// The host shows an invite as a QR code, the joiner scans it and shows an answer QR code, the host scans that.
// The WebRTC part lives in @cards/net (local.ts); this file is only the user interface for it.
import { extractCode, type Invite, type LocalHost } from "@cards/net";
import { scanQr, showQr } from "./qr.ts";
import { t } from "./i18n.ts";

/** The invite link: the game's address plus the code, so the camera app opens the game right away. */
export const inviteLink = (code: string) => `${location.origin}${location.pathname}#nearby=${code}`;
export const hasNearbyLink = () => /[#&]nearby=/.test(location.hash);
export const clearNearbyLink = () => { try { history.replaceState(null, "", location.href.split("#")[0]); } catch { /* ignore */ } };

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
}

/** One step of the handshake screen: a sentence, optionally a code to show, optionally a code to read (camera or pasted). */
export interface Handshake {
  el: HTMLElement;
  step(text: string, show: string | null, expect: ((code: string) => void) | null): void;
  close(): void;
}

export function handshake(onCancel: () => void): Handshake {
  const el = document.createElement("div"); el.className = "nearby";
  el.innerHTML = `<p class="nstep"></p><div class="nqr" hidden></div>
    <div class="row ncode" hidden><input type="text" readonly aria-label="${t("code")}"><button class="btn" data-a="copy">${t("copyCode")}</button></div>
    <video class="nvideo" playsinline muted hidden></video>
    <div class="nexpect" hidden><div class="row"><button class="btn primary" data-a="scan">📷 ${t("scanCamera")}</button></div>
      <div class="row"><input type="text" class="npaste" placeholder="${t("pasteCode")}" autocomplete="off" autocapitalize="off" spellcheck="false"><button class="btn" data-a="use">${t("useCode")}</button></div></div>
    <div class="nerr" hidden></div>
    <div class="row"><button class="btn" data-a="cancel">${t("cancel")}</button></div>`;
  const $ = <T extends HTMLElement>(s: string) => el.querySelector(s) as T;
  const stepEl = $("p.nstep"), qr = $("div.nqr"), codeRow = $("div.ncode"), codeIn = $<HTMLInputElement>("div.ncode input"), video = $<HTMLVideoElement>("video"), expectEl = $("div.nexpect"), paste = $<HTMLInputElement>("input.npaste"), err = $("div.nerr");
  let onCode: (c: string) => void = () => {}, stop: (() => void) | null = null, closed = false;
  const stopScan = () => { stop?.(); stop = null; video.hidden = true; };
  const api: Handshake = {
    el,
    step(text, show, expect) {
      if (closed) return;
      stopScan(); err.hidden = true;
      stepEl.textContent = text;
      qr.hidden = codeRow.hidden = !show;
      if (show) { showQr(qr, show); codeIn.value = show; }
      expectEl.hidden = !expect;
      onCode = expect ?? (() => {});
      if (expect) setTimeout(() => { if (!closed && onCode === expect) scan(); }, 0); // open the camera at once when the code is to be scanned
    },
    close() { closed = true; stopScan(); el.remove(); },
  };
  const fail = (text: string) => { err.textContent = text; err.hidden = false; };
  const scan = async () => {
    stopScan();
    const handler = onCode;
    try { video.hidden = false; stop = await scanQr(video, (text) => { stop = null; video.hidden = true; handler(extractCode(text)); }); }
    catch { video.hidden = true; fail(t("nearbyCam")); }
  };
  el.addEventListener("click", (e) => {
    const a = (e.target as HTMLElement).closest<HTMLElement>("[data-a]")?.dataset.a;
    if (a === "cancel") { api.close(); onCancel(); }
    else if (a === "copy") { void navigator.clipboard?.writeText(codeIn.value); }
    else if (a === "scan") void scan();
    else if (a === "use") { const c = extractCode(paste.value); paste.value = ""; if (c) { stopScan(); onCode(c); } }
  });
  return api;
}

/** Host: invite one more player. Resolves true when they are connected, false when cancelled or it did not work. */
export function inviteOne(parent: HTMLElement, host: LocalHost): Promise<boolean> {
  return new Promise((resolve) => {
    let invite: Invite | null = null, done = false;
    const finish = (ok: boolean) => { if (done) return; done = true; if (!ok) invite?.cancel(); hs.close(); resolve(ok); };
    const hs = handshake(() => finish(false));
    hs.el.classList.add("overlay");
    parent.append(hs.el);
    hs.step(t("nearbyPrep"), null, null);
    const offer = (inv: Invite, text: string) => {
      invite = inv;
      if (done) { inv.cancel(); return; }
      hs.step(text, inviteLink(inv.code), async (answer) => {
        hs.step(t("nearbyConnecting"), null, null);
        try { await withTimeout(inv.accept(answer), 15000); finish(true); }
        catch (e) {
          console.warn("nearby invite failed", e);
          inv.cancel();
          host.invite().then((n) => offer(n, t("nearbyFail"))).catch(() => finish(false));
        }
      });
    };
    host.invite().then((inv) => offer(inv, t("nearbyHostSteps"))).catch(() => finish(false));
  });
}
