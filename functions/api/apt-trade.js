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

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const lawdCd = url.searchParams.get("lawdCd");
  const dealYmd = url.searchParams.get("dealYmd");

  if (!lawdCd || !/^\d{5}$/.test(lawdCd)) {
    return jsonResponse({ error: "lawdCd는 5자리 숫자여야 합니다. 예: 11680" }, 400);
  }
  if (!dealYmd || !/^\d{6}$/.test(dealYmd)) {
    return jsonResponse({ error: "dealYmd는 6자리 숫자(YYYYMM)여야 합니다. 예: 202605" }, 400);
  }

  const cacheKey = `apt:${lawdCd}:${dealYmd}`;

  // 1. KV 캐시 확인 (바인딩이 없으면 건너뜀)
  if (env.APT_CACHE) {
    const cached = await env.APT_CACHE.get(cacheKey, "json");
    if (cached) {
      return jsonResponse({ ...cached, cached: true });
    }
  }

  // 2. 공공데이터포털 API 호출
  const apiUrl = `${API_BASE}?serviceKey=${env.APT_SERVICE_KEY}&LAWD_CD=${lawdCd}&DEAL_YMD=${dealYmd}&numOfRows=200`;

  let xmlText;
  try {
    // User-Agent 헤더가 없으면 공공데이터포털 WAF가 요청을 차단(400 Request Blocked)하므로 필수로 지정
    const apiRes = await fetch(apiUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; excelzip-apt-review/1.0)" },
    });
    xmlText = await apiRes.text();
  } catch (err) {
    return jsonResponse({ error: "실거래가 API 호출 실패", detail: String(err) }, 502);
  }

  const items = parseItems(xmlText);
  const resultCode = matchTag(xmlText, "resultCode");

  if (resultCode !== "000") {
    const resultMsg = matchTag(xmlText, "resultMsg") || "알 수 없는 오류";
    return jsonResponse({ error: `API 오류 (코드 ${resultCode}): ${resultMsg}` }, 502);
  }

  const payload = { lawdCd, dealYmd, count: items.length, items, cached: false };

  // 3. KV에 저장 (있으면)
  if (env.APT_CACHE) {
    await env.APT_CACHE.put(cacheKey, JSON.stringify(payload), {
      expirationTtl: CACHE_TTL_SECONDS,
    });
  }

  return jsonResponse(payload);
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

function matchTag(text, tag) {
  const m = text.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return m ? m[1] : "";
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
