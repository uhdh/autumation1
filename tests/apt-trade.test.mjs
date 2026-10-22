// 실행: node --test tests/apt-trade.test.mjs
// 공공데이터포털 응답을 가짜 fetch로 대체해 apt-trade 프록시의 입력 검증·페이지 처리를 점검한다.
import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet } from "../functions/api/apt-trade.js";

const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; });

const call = (qs, env = { APT_SERVICE_KEY: "k" }) =>
  onRequestGet({ request: new Request(`https://x.test/api/apt-trade?${qs}`), env });

const page = (names, totalCount) =>
  `<response><header><resultCode>000</resultCode></header><body><items>${names
    .map((n) => `<item><aptNm>${n}</aptNm><umdNm>개포동</umdNm><dealAmount>100,000</dealAmount></item>`)
    .join("")}</items><totalCount>${totalCount}</totalCount></body></response>`;

test("서울 외 지역코드·잘못된 계약월·키 누락은 상위 API를 호출하지 않고 거절", async () => {
  globalThis.fetch = () => assert.fail("상위 API를 호출하면 안 됨");
  assert.equal((await call("lawdCd=26110&dealYmd=202605")).status, 400);
  assert.equal((await call("lawdCd=11680&dealYmd=202613")).status, 400);
  assert.equal((await call("lawdCd=11680&dealYmd=202605", {})).status, 500);
});

test("totalCount에 닿을 때까지 페이지를 넘겨 전부 모은다", async () => {
  const pages = [page(["가", "나"], 3), page(["다&amp;라"], 3)];
  const requested = [];
  globalThis.fetch = async (url) => {
    requested.push(new URL(url).searchParams.get("pageNo"));
    return new Response(pages[requested.length - 1]);
  };
  const res = await call("lawdCd=11680&dealYmd=202605");
  const data = await res.json();
  assert.deepEqual(requested, ["1", "2"]);
  assert.equal(data.count, 3);
  assert.equal(data.items[2].aptNm, "다&라"); // XML 엔티티는 평문으로 풀려야 함
  assert.equal(data.items[0].dealAmountManwon, 100000);
  assert.match(res.headers.get("cache-control"), /max-age/);
});

test("상위 API 오류 코드는 502로 전달하고 캐시하지 않는다", async () => {
  globalThis.fetch = async () =>
    new Response("<response><header><resultCode>030</resultCode><resultMsg>KEY ERROR</resultMsg></header></response>");
  const res = await call("lawdCd=11680&dealYmd=202605");
  assert.equal(res.status, 502);
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("불완전한 페이지와 비정상 응답은 성공 처리하거나 캐시하지 않는다", async () => {
  const cases = [
    [page(["가"], 2), page([], 2)],
    Array(10).fill(page(["가"], 11)),
    [page(["가"], "")],
    [page(["가"], "2oops")],
    [page(["가"], 2), page(["나"], 3)],
    [page(["가", "나"], 1)],
    [new Response(page(["가"], 1), { status: 503 })],
  ];
  for (const pages of cases) {
    let requested = 0;
    globalThis.fetch = async () => {
      assert.ok(requested < pages.length, "불필요한 추가 요청");
      const body = pages[requested++];
      return body instanceof Response ? body : new Response(body);
    };
    const res = await call("lawdCd=11680&dealYmd=202605", {
      APT_SERVICE_KEY: "k",
      APT_CACHE: { get: async () => null, put: async () => assert.fail("불완전한 응답 캐시 금지") },
    });
    assert.equal(res.status, 502);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(requested, pages.length);
  }
});

test("정상적인 0건 응답은 빈 결과로 반환한다", async () => {
  globalThis.fetch = async () => new Response(page([], 0));
  const res = await call("lawdCd=11680&dealYmd=202605");
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).items, []);
});
