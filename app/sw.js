// Diário ABC: recebe os lembretes e deixa o app abrir mesmo com internet fraca.
const CACHE = "abc-v8";
const BASICO = ["./", "./index.html", "./config.js", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(BASICO)).catch(() => {})); self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { const copia = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copia)).catch(() => {}); return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match("./index.html"))));
});
function idb(modo, k, v) {
  return new Promise(res => { try { const r = indexedDB.open("abc", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => { try { const st = r.result.transaction("kv", modo).objectStore("kv"); const q = modo === "readwrite" ? st.put(v, k) : st.get(k);
      q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); } catch { res(undefined); } };
    r.onerror = () => res(undefined); } catch { res(undefined); } });
}
const lerCompras = async () => (await idb("readonly", "compras")) || [];
const pad2 = n => String(n).padStart(2, "0");
// "Já tomei" direto na notificação: anota no aparelho e avisa o servidor para parar de repetir
async function tomeiRemedio() {
  const d = new Date(); const dia = d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); const hm = pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  const ag = await idb("readonly", "agenda"); const cfg = await idb("readonly", "cfg");
  let rd = (await idb("readonly", "remedioDia")) || {}; if (rd.dia !== dia) rd = { dia, tomadas: [], pend: false };
  const rm = ag && Array.isArray(ag.agenda) ? ag.agenda.find(x => x && x.k === "remedio") : null;
  const horas = rm && Array.isArray(rm.horas) ? rm.horas : [];
  rd = { dia, tomadas: [...new Set([...(rd.tomadas || []), ...horas.filter(x => x <= hm)])], pend: false };
  await idb("readwrite", "remedioDia", rd);
  if (!ag || !cfg || !cfg.url) return;
  const agenda = ag.agenda.map(x => x && x.k === "remedio" ? { ...x, dia, tomadas: rd.tomadas, pend: false } : x);
  const cab = { apikey: cfg.chave, "Content-Type": "application/json" }; if (String(cfg.chave).startsWith("eyJ")) cab.Authorization = "Bearer " + cfg.chave;
  try { const r = await fetch(cfg.url.replace(/\/+$/, "") + "/rest/v1/rpc/abc_lembrete_agenda", { method: "POST", headers: cab, body: JSON.stringify({ endpoint: ag.endpoint, agenda, tem_compras: !!ag.tem_compras }) });
    if (r.ok) await idb("readwrite", "agenda", { ...ag, agenda }); } catch {}
}
const TEXTOS = {
  sai:   ["Saindo de casa?", "Falta comprar: ", "Confere: chave, carteira, celular e remédio."],
  meio:  ["Dá pra passar numa loja?", "Falta comprar: ", "Dá uma olhada na sua lista de compras."],
  volta: ["Já vai voltar pra casa?", "Antes, passa pra comprar: ", "Dá uma olhada na sua lista de compras."]
};
self.addEventListener("push", e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil((async () => {
    let title = d.title || "Diário ABC", body = d.body || "Que tal fazer seu check-in de hoje?";
    const t = TEXTOS[d.tipo];
    if (t) {
      const itens = await lerCompras();
      title = t[0];
      body = itens.length ? t[1] + itens.slice(0, 6).join(", ") + (itens.length > 6 ? "…" : "") + (d.tipo === "sai" ? ". Leve também chave, carteira e celular." : "") : t[2];
    }
    const extra = d.tipo === "remedio" ? { actions: [{ action: "tomei", title: "Já tomei" }], renotify: true, requireInteraction: true } : {};
    if (d.tipo === "remedio") { title = d.title || "Hora do remédio"; body = d.body || "Já tomou o remédio? Toque em \u201cJá tomei\u201d quando tomar."; }
    await self.registration.showNotification(title, { body, icon: "icon-192.png", badge: "icon-192.png", tag: d.tag || d.tipo || "checkin", data: { url: d.url || "./" }, ...extra });
  })());
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  if (e.action === "tomei") { e.waitUntil(tomeiRemedio()); return; }
  const alvo = new URL((e.notification.data && e.notification.data.url) || "./", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(cs => {
    for (const c of cs) if (c.url.startsWith(self.registration.scope) && "focus" in c) { c.navigate(alvo).catch(() => {}); return c.focus(); }
    return self.clients.openWindow(alvo);
  }));
});
