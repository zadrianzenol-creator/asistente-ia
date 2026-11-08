'use strict';
/**
 * Límites anti-abuso en memoria (sin cuentas):
 *  - ventana de 1 minuto por IP
 *  - tope diario por IP
 *  - tope diario global (protege la cuota gratuita del proveedor)
 *  - máximo de generaciones simultáneas por IP
 *
 * Al reiniciar el proceso los contadores se reinician. Para varias instancias
 * habría que moverlos a Redis o similar.
 */
function createLimiter(opts) {
  const o = Object.assign({ perMinute: 12, perDay: 150, globalPerDay: 1500, maxConcurrent: 2 }, opts);
  const minute = new Map();   // ip -> [timestamps]
  const day = new Map();      // ip -> { key, n }
  const active = new Map();   // ip -> n
  let global = { key: '', n: 0 };

  const dayKey = (now) => new Date(now).toISOString().slice(0, 10);

  function check(ip, now = Date.now()) {
    const dk = dayKey(now);
    if (global.key !== dk) global = { key: dk, n: 0 };
    if (global.n >= o.globalPerDay) {
      return { ok: false, code: 'service_busy', status: 503, retryAfter: 3600,
        message: 'El servicio alcanzó su límite diario de uso gratuito. Inténtalo de nuevo más tarde.' };
    }
    const d = day.get(ip);
    if (d && d.key === dk && d.n >= o.perDay) {
      return { ok: false, code: 'daily_limit', status: 429, retryAfter: 3600,
        message: 'Alcanzaste el límite diario de mensajes para este dispositivo. Vuelve mañana.' };
    }
    const recent = (minute.get(ip) || []).filter((t) => now - t < 60000);
    if (recent.length >= o.perMinute) {
      const wait = Math.max(1, Math.ceil((60000 - (now - recent[0])) / 1000));
      return { ok: false, code: 'rate_limit', status: 429, retryAfter: wait,
        message: `Vas muy rápido. Espera ${wait} s e inténtalo otra vez.` };
    }
    if ((active.get(ip) || 0) >= o.maxConcurrent) {
      return { ok: false, code: 'too_many_active', status: 429, retryAfter: 5,
        message: 'Ya tienes respuestas en curso. Espera a que terminen o deténlas.' };
    }
    return { ok: true };
  }

  function consume(ip, now = Date.now()) {
    const dk = dayKey(now);
    if (global.key !== dk) global = { key: dk, n: 0 };
    global.n++;
    const d = day.get(ip);
    if (!d || d.key !== dk) day.set(ip, { key: dk, n: 1 }); else d.n++;
    const recent = (minute.get(ip) || []).filter((t) => now - t < 60000);
    recent.push(now); minute.set(ip, recent);
  }

  function begin(ip) { active.set(ip, (active.get(ip) || 0) + 1); }
  function end(ip) {
    const n = (active.get(ip) || 1) - 1;
    if (n <= 0) active.delete(ip); else active.set(ip, n);
  }

  // Limpieza periódica para que los mapas no crezcan sin fin.
  function sweep(now = Date.now()) {
    for (const [ip, arr] of minute) { const r = arr.filter((t) => now - t < 60000); if (r.length) minute.set(ip, r); else minute.delete(ip); }
    const dk = dayKey(now);
    for (const [ip, d] of day) if (d.key !== dk) day.delete(ip);
  }

  return { check, consume, begin, end, sweep, _state: () => ({ minute, day, active, global }) };
}

module.exports = { createLimiter };
