// Cloudflare Pages Functions 프록시
// 배포 경로: /functions/api/apt-trade.js → 호출 주소: /api/apt-trade?lawdCd=11680&dealYmd=202605
//
// 역할:
// 1. 브라우저에서 직접 호출 불가능한 공공데이터포털 API를 서버 측에서 대신 호출 (CORS 우회)
// 2. serviceKey를 클라이언트에 노출하지 않고 환경변수로 보관
// 3. Cloudflare KV에 응답을 캐싱해 호출 횟수를 줄이고 응답 속도를 높임 (하루 1회 갱신되는 데이터 특성에 맞춤)
//
// 사전 준비:
// - Cloudflare Pages 프로젝트 설정 > 환경 변수에 APT_SERVICE_KEY 추가 (Decoding 안 된 원본 키, 즉 %2B 등이 포함된 인코딩 키)
// - KV 네임스페이스를 만들어 바인딩 이름 APT_CACHE 로 연결 (캐싱을 쓰지 않으려면 생략 가능, 아래 코드는 KV 없이도 동작)

const API_BASE = "https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade";
const CACHE_TTL_SECONDS = 60 * 60 * 6; // 6시간 캐시 (데이터 자체는 하루 1회 갱신이므로 충분)
const BROWSER_CACHE_SECONDS = 60 * 10; // 같은 구·월 재조회(최다거래 집계 등)가 함수까지 오지 않도록 브라우저에도 짧게 캐시
const PAGE_SIZE = 1000;
const MAX_PAGES = 10; // 구·월 단위 거래가 1만 건을 넘지는 않음. 응답 이상 시 무한 반복 방지용 상한

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const lawdCd = url.searchParams.get("lawdCd");
  const dealYmd = url.searchParams.get("dealYmd");

  // 이 사이트는 서울만 다루므로 서울(11xxx) 외 코드는 거절 — 공개 배포 시 범용 프록시로 쓰이는 것을 막음
  if (!lawdCd || !/^11\d{3}$/.test(lawdCd)) {
    return jsonResponse({ error: "lawdCd는 서울 법정동코드 5자리(11로 시작)여야 합니다. 예: 11680" }, 400);
  }
  if (!dealYmd || !/^20\d{2}(0[1-9]|1[0-2])$/.test(dealYmd)) {
    return jsonResponse({ error: "dealYmd는 6자리 숫자(YYYYMM)여야 합니다. 예: 202605" }, 400);
  }
  if (!env.APT_SERVICE_KEY) {
    return jsonResponse({ error: "실거래가 API 키(APT_SERVICE_KEY)가 설정되지 않았습니다." }, 500);
  }

  const cacheKey = `apt:v2:${lawdCd}:${dealYmd}`;

  // 1. KV 캐시 확인 (바인딩이 없으면 건너뜀)
  if (env.APT_CACHE) {
    const cached = await env.APT_CACHE.get(cacheKey, "json");
    if (cached) {
      return jsonResponse({ ...cached, cached: true }, 200, BROWSER_CACHE_SECONDS);
    }
  }

  // 2. 공공데이터포털 API 호출 — 거래가 많은 구·월은 한 페이지에 다 안 들어오므로 totalCount에 닿을 때까지 페이지를 넘김
  const items = [];
  let totalCount = null;
  try {
    for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo++) {
      const apiUrl = `${API_BASE}?serviceKey=${env.APT_SERVICE_KEY}&LAWD_CD=${lawdCd}&DEAL_YMD=${dealYmd}&numOfRows=${PAGE_SIZE}&pageNo=${pageNo}`;
      // User-Agent 헤더가 없으면 공공데이터포털 WAF가 요청을 차단(400 Request Blocked)하므로 필수로 지정
      const apiRes = await fetch(apiUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; excelzip-apt-review/1.0)" },
      });
      const xmlText = await apiRes.text();
      if (!apiRes.ok) {
        return jsonResponse({ error: `실거래가 API HTTP 오류 (${apiRes.status})` }, 502);
      }

      const resultCode = matchTag(xmlText, "resultCode");
      if (resultCode !== "000") {
        const resultMsg = matchTag(xmlText, "resultMsg") || "알 수 없는 오류";
        return jsonResponse({ error: `API 오류 (코드 ${resultCode}): ${resultMsg}` }, 502);
      }

      const pageItems = parseItems(xmlText);
      items.push(...pageItems);
      const countText = matchTag(xmlText, "totalCount").trim();
      const pageTotal = /^\d+$/.test(countText) ? Number(countText) : NaN;
      if (!Number.isSafeInteger(pageTotal) || (totalCount !== null && totalCount !== pageTotal)) {
        return jsonResponse({ error: "실거래가 API의 전체 건수가 누락되거나 변경되었습니다. 다시 조회해 주세요." }, 502);
      }
      totalCount = pageTotal;
      if (!pageItems.length || items.length >= totalCount) break;
    }
  } catch (err) {
    return jsonResponse({ error: "실거래가 API 호출 실패", detail: String(err) }, 502);
  }

  if (items.length !== totalCount) {
    return jsonResponse({ error: "전체 거래를 가져오지 못했습니다. 다시 조회해 주세요." }, 502);
  }

  const payload = { lawdCd, dealYmd, count: items.length, items, cached: false };

  // 3. KV에 저장 (있으면)
  if (env.APT_CACHE) {
    await env.APT_CACHE.put(cacheKey, JSON.stringify(payload), {
      expirationTtl: CACHE_TTL_SECONDS,
    });
  }

  return jsonResponse(payload, 200, BROWSER_CACHE_SECONDS);
}

// XML <item>...</item> 블록을 단순 정규식으로 파싱 (의존성 없이 Workers 런타임에서 동작)
function parseItems(xmlText) {
  const itemBlocks = xmlText.match(/<item>[\s\S]*?<\/item>/g) || [];
  return itemBlocks.map((block) => {
    const get = (tag) => matchTag(block, tag);
    const dealAmountRaw = get("dealAmount") || "";
    return {
      aptNm: get("aptNm"),
      umdNm: get("umdNm"),
      jibun: get("jibun"),
      excluUseAr: parseFloat(get("excluUseAr")) || null,
      dealYear: get("dealYear"),
      dealMonth: get("dealMonth"),
      dealDay: get("dealDay"),
      dealAmountManwon: parseInt(dealAmountRaw.replace(/,/g, ""), 10) || null,
      floor: get("floor"),
      buildYear: get("buildYear"),
      dealingGbn: get("dealingGbn"),
      aptDong: get("aptDong")?.trim() || null,
      // cdealType에 값이 있으면 해제(취소)된 거래
      isCancelled: Boolean(get("cdealType")?.trim()),
    };
  });
}

const XML_ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };

// 값은 XML 엔티티를 풀어 평문으로 돌려줌 (화면 쪽에서 escapeHtml로 다시 이스케이프하므로 이중 인코딩 방지)
function matchTag(text, tag) {
  const m = text.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return m ? m[1].replace(/&(amp|lt|gt|quot|apos);/g, (e) => XML_ENTITIES[e]) : "";
}

// 오류 응답은 캐시하지 않음 (maxAge 0)
function jsonResponse(obj, status = 200, maxAge = 0) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": maxAge ? `public, max-age=${maxAge}` : "no-store",
    },
  });
}
