const apiOrigin = 'https://planthegame.ch';
const tenantId = 'e5a30adc-0ded-4511-a10c-17e9078a49bf';
const season = '2026-27';
const cacheTtlSeconds = 21600;

function jsonResponse(data, status = 200, origin = null, extraHeaders = {}) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': `public, max-age=${cacheTtlSeconds}`,
    ...extraHeaders
  });
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
  }
  return new Response(JSON.stringify(data), { status, headers });
}

function berlinDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function isTodaysMatch(match, today) {
  if (!match || typeof match !== 'object'
    || match.isPublished !== true
    || typeof match.date !== 'string'
    || typeof match.homeTeam !== 'string'
    || typeof match.awayTeam !== 'string') {
    return false;
  }

  const dateParts = /^(\d{2})\.(\d{2})\.(\d{4})\s*-\s*(\d{2}):(\d{2})$/.exec(match.date);
  if (!dateParts) return false;

  const [, day, month, year, hour, minute] = dateParts;
  const calendarDate = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)));
  if (calendarDate.getUTCFullYear() !== Number(year)
    || calendarDate.getUTCMonth() !== Number(month) - 1
    || calendarDate.getUTCDate() !== Number(day)
    || Number(hour) > 23
    || Number(minute) > 59) {
    return false;
  }

  return `${year}-${month}-${day}` === today;
}

function teamName(value) {
  return value.replaceAll('_', ' ').trim().slice(0, 80);
}

function withCors(response, origin) {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Vary', 'Origin');
  return new Response(response.body, { status: response.status, headers });
}

export default {
  async fetch(request, env, context) {
    const origin = request.headers.get('Origin');
    const allowedOrigins = (env.ALLOWED_ORIGINS ?? '').split(',').map((value) => value.trim());
    if (!origin || !allowedOrigins.includes(origin)) {
      return jsonResponse({ error: 'Origin not allowed.' }, 403);
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
          'Vary': 'Origin'
        }
      });
    }

    if (request.method !== 'GET' || new URL(request.url).pathname !== '/api/forecast') {
      return jsonResponse({ error: 'Not found.' }, 404, origin);
    }

    let failureStage = 'Rate-Limit-Prüfung';
    try {
      if (!env.OPENAI_API_KEY) {
        return jsonResponse({ error: 'Die KI-Prognose ist noch nicht konfiguriert.' }, 503, origin, {
          'Cache-Control': 'no-store'
        });
      }

      const clientIp = request.headers.get('CF-Connecting-IP') ?? 'unknown';
      const { success } = await env.RATE_LIMITER.limit({ key: clientIp });
      if (!success) {
        return jsonResponse({ error: 'Zu viele Anfragen. Bitte später erneut versuchen.' }, 429, origin, {
          'Cache-Control': 'no-store'
        });
      }

      failureStage = 'Match-API';
      const today = berlinDate();
      const cacheKey = new Request(`https://match-of-the-day-cache.invalid/v2/${today}`);
      const cached = await caches.default.match(cacheKey);
      if (cached) return withCors(cached, origin);

      const matchesResponse = await fetch(`${apiOrigin}/Match/${tenantId}/${season}/active/true`);
      if (!matchesResponse.ok) {
        throw new Error(`Match-API antwortete mit HTTP ${matchesResponse.status}.`);
      }
      const matches = await matchesResponse.json();
      if (!Array.isArray(matches)) {
        throw new Error('Die Match-API hat ein unerwartetes Datenformat zurückgegeben.');
      }

      const match = matches.find((entry) => isTodaysMatch(entry, today));
      if (!match) return jsonResponse({ error: 'Heute findet kein veröffentlichtes Match statt.' }, 404, origin);

      const homeTeam = teamName(match.homeTeam);
      const awayTeam = teamName(match.awayTeam);
      if (!homeTeam || !awayTeam) throw new Error('Die Teamnamen des Matches sind ungültig.');

      failureStage = 'OpenAI-API';
      const predictionResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-6-luna',
          messages: [
            {
              role: 'system',
              content: 'Schreibe auf Deutsch eine ausführlichere, unterhaltsame und ausdrücklich spekulative Einschätzung zu einem Fußballspiel aus der Perspektive eines leidenschaftlichen SC-Freiburg-Fans. Der Ton darf trocken und leicht sarkastisch sein, soll aber freundlich bleiben. Verwende ausschließlich die übergebenen Teamnamen und die Information, dass diese Mannschaften heute gegeneinander spielen. Erfinde keine Informationen zu Tabellenstand, Form, Verletzungen, Statistiken, Quoten oder sonstigen Fakten. Behaupte nicht, dass der SC Freiburg beteiligt ist, sofern er nicht ausdrücklich in den Teamnamen vorkommt. Formuliere einen unterhaltsamen Tipp mit einer nachvollziehbaren, aber ausdrücklich spekulativen Einschätzung des möglichen Spielverlaufs. Antworte in 4–6 Sätzen als gültiges JSON-Objekt mit genau einem String-Feld namens "prediction".'
            },
            {
              role: 'user',
              content: JSON.stringify({ homeTeam, awayTeam, matchDate: match.date })
            }
          ],
          response_format: { type: 'json_object' },
          max_tokens: 200,
          temperature: 0.4
        })
      });
      if (!predictionResponse.ok) {
        console.error(`OpenAI-API antwortete mit HTTP ${predictionResponse.status}.`);
        return jsonResponse({
          error: `OpenAI-API antwortete mit HTTP ${predictionResponse.status}. Bitte API-Key, Modellzugriff und API-Guthaben prüfen.`
        }, 502, origin, { 'Cache-Control': 'no-store' });
      }

      failureStage = 'Verarbeitung der KI-Antwort';
      const predictionData = await predictionResponse.json();
      const content = predictionData.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new Error('OpenAI lieferte keine Prognose.');

      const result = JSON.parse(content);
      if (typeof result.prediction !== 'string'
        || result.prediction.trim().length === 0
        || result.prediction.length > 600) {
        throw new Error('OpenAI lieferte eine ungültige Prognose.');
      }

      const response = jsonResponse({ prediction: result.prediction.trim() }, 200, origin);
      const cacheResponse = new Response(response.clone().body, {
        status: response.status,
        headers: response.headers
      });
      cacheResponse.headers.delete('Access-Control-Allow-Origin');
      cacheResponse.headers.delete('Vary');
      context.waitUntil(caches.default.put(cacheKey, cacheResponse));
      return response;
    } catch (error) {
      console.error(`Match-Prognose fehlgeschlagen (${failureStage}).`, error);
      return jsonResponse({ error: `Die KI-Prognose ist gerade nicht verfügbar (${failureStage}).` }, 502, origin, {
        'Cache-Control': 'no-store'
      });
    }
  }
};
