// Cloudflare Pages Functions 프록시 — 네이버 뉴스 검색 API
// 배포 경로: /functions/api/apt-news.js → 호출 주소: /api/apt-news?query=강남구%20부동산
//
// 역할:
// 1. 네이버 오픈API는 서버 사이드 호출을 전제로 하므로(브라우저 직접 호출 시 CORS 차단) 프록시로 대신 호출
// 2. Client-Id/Secret을 클라이언트에 노출하지 않고 환경변수로 보관
// 3. Cloudflare KV에 짧게 캐싱해 호출 횟수를 줄임 (뉴스는 실거래가보다 자주 바뀌므로 TTL을 짧게 둠)
//
// 사전 준비:
// - 네이버 개발자센터(developers.naver.com)에서 애플리케이션 등록 후 검색 API 사용 설정
// - Cloudflare Pages 프로젝트 설정 > 환경 변수에 NAVER_CLIENT_ID, NAVER_CLIENT_SECRET 추가
// - KV 네임스페이스 APT_CACHE를 apt-trade.js와 공유해서 사용 (없어도 동작은 함)

const API_BASE = "https://openapi.naver.com/v1/search/news.json";
const CACHE_TTL_SECONDS = 60 * 30; // 30분 캐시
const DISPLAY_COUNT = 10;

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const query = (url.searchParams.get("query") || "부동산").slice(0, 100);

  if (!env.NAVER_CLIENT_ID || !env.NAVER_CLIENT_SECRET) {
    return jsonResponse({ error: "네이버 API 키(NAVER_CLIENT_ID/NAVER_CLIENT_SECRET)가 설정되지 않았습니다." }, 500);
  }

  const cacheKey = `news:${query}`;

  // 1. KV 캐시 확인 (바인딩이 없으면 건너뜀)
  if (env.APT_CACHE) {
    const cached = await env.APT_CACHE.get(cacheKey, "json");
    if (cached) {
      return jsonResponse({ ...cached, cached: true });
    }
  }

  // 2. 네이버 뉴스 검색 API 호출
  const apiUrl = `${API_BASE}?query=${encodeURIComponent(query)}&display=${DISPLAY_COUNT}&sort=date`;

  let data;
  try {
    const apiRes = await fetch(apiUrl, {
      headers: {
        "X-Naver-Client-Id": env.NAVER_CLIENT_ID,
        "X-Naver-Client-Secret": env.NAVER_CLIENT_SECRET,
      },
    });
    if (!apiRes.ok) {
      const detail = await apiRes.text();
      return jsonResponse({ error: `네이버 뉴스 API 오류 (${apiRes.status})`, detail }, 502);
    }
    data = await apiRes.json();
  } catch (err) {
    return jsonResponse({ error: "네이버 뉴스 API 호출 실패", detail: String(err) }, 502);
  }

  const items = (data.items || []).map((it) => ({
    title: stripHtml(it.title),
    description: stripHtml(it.description),
    link: it.originallink || it.link,
    pubDate: it.pubDate,
  }));

  const payload = { query, count: items.length, items, cached: false };

  // 3. KV에 저장 (있으면)
  if (env.APT_CACHE) {
    await env.APT_CACHE.put(cacheKey, JSON.stringify(payload), {
      expirationTtl: CACHE_TTL_SECONDS,
    });
  }

  return jsonResponse(payload);
}

// 네이버 검색 결과의 title/description에는 <b> 강조 태그와 HTML 엔티티가 섞여 있어 제거
function stripHtml(str) {
  if (!str) return "";
  return str
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
