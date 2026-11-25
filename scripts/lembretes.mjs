// Envia o lembrete de check-in para quem pediu, no horário escolhido.
// Roda no GitHub Actions a cada 15 minutos. Precisa dos segredos SUPABASE_URL e SUPABASE_SECRET_KEY.
import webpush from "web-push";

const URL_BASE = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const CHAVE = process.env.SUPABASE_SECRET_KEY || "";
const APP_URL = process.env.APP_URL || "https://github.com";
if (!URL_BASE || !CHAVE) { console.error("Faltam os segredos SUPABASE_URL e SUPABASE_SECRET_KEY."); process.exit(1); }

const cab = { apikey: CHAVE, "Content-Type": "application/json" };
if (CHAVE.startsWith("eyJ")) cab.Authorization = "Bearer " + CHAVE;
async function rest(caminho, opcoes = {}) {
  const r = await fetch(URL_BASE + "/rest/v1/" + caminho, { ...opcoes, headers: { ...cab, ...(opcoes.headers || {}) } });
  if (!r.ok) throw new Error(caminho + " -> " + r.status + " " + (await r.text()));
  const t = await r.text(); return t ? JSON.parse(t) : null;
}

async function chavesVapid() {
  const linhas = await rest("abc_servidor?select=k,v&k=in.(vapid_publica,vapid_privada)");
  const m = Object.fromEntries(linhas.map(l => [l.k, l.v]));
  if (m.vapid_publica && m.vapid_privada) return { publicKey: m.vapid_publica, privateKey: m.vapid_privada };
  const novas = webpush.generateVAPIDKeys();
  await rest("abc_servidor", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify([{ k: "vapid_publica", v: novas.publicKey }, { k: "vapid_privada", v: novas.privateKey }]) });
  console.log("Chaves de notificação criadas.");
  return novas;
}

function agoraEm(tz) {
  let fuso = tz; try { new Intl.DateTimeFormat("pt-BR", { timeZone: fuso }); } catch { fuso = "America/Sao_Paulo"; }
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).map(x => [x.type, x.value]));
  const dow = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(new Intl.DateTimeFormat("en-US", { timeZone: fuso, weekday: "short" }).format(new Date()));
  return { dia: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}`, dow };
}

const vapid = await chavesVapid();
webpush.setVapidDetails(APP_URL, vapid.publicKey, vapid.privateKey);
const min = hm => { const [h, m] = String(hm).split(":").map(Number); return h * 60 + m; };
const hhmm = n => String(Math.floor(n / 60)).padStart(2, "0") + ":" + String(n % 60).padStart(2, "0");
// avisos de saída: na hora de sair, no meio do tempo fora (se for 1h30 ou mais) e meia hora antes de voltar
function eventosDeSaida(agenda, dow) {
  const ev = [];
  (Array.isArray(agenda) ? agenda : []).forEach((a, i) => {
    if (!a || !Array.isArray(a.dias) || !a.dias.includes(dow)) return;
    const s = min(a.sai), v = min(a.volta); if (!(v > s)) return;
    ev.push({ id: i + "-sai", tipo: "sai", em: s });
    if (v - s >= 90) ev.push({ id: i + "-meio", tipo: "meio", em: Math.round((s + v) / 2) });
    if (v - 30 > s + 30) ev.push({ id: i + "-volta", tipo: "volta", em: v - 30 });
  });
  return ev;
}
async function enviar(l, carga) { await webpush.sendNotification(l.sub, JSON.stringify(carga), { TTL: 2 * 3600 }); }
const lista = await rest("abc_lembretes?select=endpoint,sub,hora,tz,ultimo_checkin,ultimo_envio,agenda,tem_compras,enviados");
let enviados = 0, removidos = 0;
for (const l of lista) {
  const { dia, hm, dow } = agoraEm(l.tz);
  const enc = encodeURIComponent(l.endpoint);
  const patch = {};
  try {
    if (l.hora && hm >= l.hora && l.ultimo_envio !== dia && l.ultimo_checkin !== dia) {
      await enviar(l, { title: "Diário ABC", body: "Oi! Que tal fazer seu check-in de hoje? Leva uns 2 minutos.", url: "./?abrir=checkin", tag: "checkin-" + dia });
      patch.ultimo_envio = dia; enviados++;
    }
    const ja = l.enviados && l.enviados.dia === dia ? [...(l.enviados.ids || [])] : [];
    let mudou = false;
    for (const ev of eventosDeSaida(l.agenda, dow)) {
      const agora = min(hm);
      if (agora < ev.em || agora > ev.em + 60 || ja.includes(ev.id)) continue;
      if (ev.tipo !== "sai" && !l.tem_compras) { ja.push(ev.id); mudou = true; continue; }
      await enviar(l, { tipo: ev.tipo, url: "./?abrir=compras", tag: ev.tipo + "-" + dia + "-" + ev.id });
      ja.push(ev.id); mudou = true; enviados++;
    }
    if (mudou) patch.enviados = { dia, ids: ja };
    if (Object.keys(patch).length) await rest("abc_lembretes?endpoint=eq." + enc, { method: "PATCH", body: JSON.stringify(patch) });
  } catch (e) {
    if (e.statusCode === 404 || e.statusCode === 410) { await rest("abc_lembretes?endpoint=eq." + enc, { method: "DELETE" }); removidos++; }
    else console.error("Falhou um envio:", e.statusCode || e.message);
  }
}
console.log(`Avisos: ${lista.length} aparelhos, ${enviados} enviados agora, ${removidos} aparelhos que saíram foram removidos.`);
