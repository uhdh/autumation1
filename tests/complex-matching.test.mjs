// 실행: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

test("단지 정보는 같은 구·동의 유일한 후보만 사용하고 동명 단지를 구분한다", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const complexes = JSON.parse(await readFile(new URL("../seoul_apt_complex.json", import.meta.url), "utf8"));
  const context = vm.createContext({
    fetch: async url => ({ json: async () => url.includes("chopuma") ? [] : complexes }),
  });
  vm.runInContext(html.slice(html.indexOf("let seoulComplexList ="), html.indexOf("// 선택된 구 이름 기준으로 부동산 뉴스 조회")), context);
  await vm.runInContext("loadSeoulComplexList()", context);
  const run = code => vm.runInContext(code, context);
  assert.equal(run("matchSeoulComplex('현대2차(10,11,20,23,24,25동)', '압구정동', '강남구')"), null);
  assert.equal(run("matchSeoulComplex('둔촌현대2차', '압구정동', '강남구')"), null);
  assert.equal(run("matchSeoulComplex('도곡렉슬', '도곡동', '강남구').householdCount"), 3002);
  assert.equal(run("matchSeoulComplex('도곡렉슬', '도곡동', '다른구')"), null);
  run(`seoulComplexList = [
    {kaptName:'동명', gu:'가구', dong:'가동', householdCount:100},
    {kaptName:'동명', gu:'가구', dong:'나동', householdCount:200},
    {kaptName:'현대1차', gu:'가구', dong:'가동'},
    {kaptName:'현대2차', gu:'가구', dong:'가동'}
  ]; seoulComplexByName = new Map([['동명', seoulComplexList.slice(0,2)]]);`);
  assert.equal(run("matchSeoulComplex('현대', '가동', '가구')"), null);
  assert.equal(run("matchSeoulComplex('현대1', '가동', '가구').kaptName"), "현대1차");
  run("var items = [{aptNm:'동명', umdNm:'가동'}, {aptNm:'동명', umdNm:'나동'}, {aptNm:'동명', umdNm:'다동'}]");
  context.basis = await run("loadHouseholdCounts(items, '가구')");
  assert.equal(context.basis.size, 2);
  assert.equal(run("basis.get(complexKey(items[0])).householdCount"), 100);
  assert.equal(run("basis.get(complexKey(items[1])).householdCount"), 200);
  assert.equal(run("filterMandatoryManaged(items, basis).length"), 2);
});
