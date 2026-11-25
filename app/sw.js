// Diário ABC: recebe os lembretes e deixa o app abrir mesmo com internet fraca.
const CACHE = "abc-v2";
const BASICO = ["./", "./index.html", "./config.js", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(BASICO)).catch(() => {})); self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { const copia = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copia)).catch(() => {}); return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match("./index.html"))));
});
function lerCompras() {
  return new Promise(res => { try { const r = indexedDB.open("abc", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => { try { const q = r.result.transaction("kv").objectStore("kv").get("compras"); q.onsuccess = () => res(q.result || []); q.onerror = () => res([]); } catch { res([]); } };
    r.onerror = () => res([]); } catch { res([]); } });
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
    await self.registration.showNotification(title, { body, icon: "icon-192.png", badge: "icon-192.png", tag: d.tag || d.tipo || "checkin", data: { url: d.url || "./" } });
  })());
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const alvo = new URL((e.notification.data && e.notification.data.url) || "./", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(cs => {
    for (const c of cs) if (c.url.startsWith(self.registration.scope) && "focus" in c) { c.navigate(alvo).catch(() => {}); return c.focus(); }
    return self.clients.openWindow(alvo);
  }));
});
