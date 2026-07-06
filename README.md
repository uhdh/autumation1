# 엑셀아파트 — 아파트 실거래가 위장 사이트

> "회사에서 엑셀 보는 척" 하면서 관심 아파트 단지의 실거래가를 확인하는 웹 서비스

Microsoft Excel 스프레드시트 UI를 위장 껍데기로 사용하고, 실제 콘텐츠는 국토교통부 아파트 실거래가 데이터를 보여줍니다.

## 기능

- Excel 리본 UI 위장 (제목표시줄, 시트 탭 포함)
- 관심 아파트 단지 검색 및 실거래가 조회
- 단지별 년식(실거래가 API) · 세대수(`seoul_apt_complex.json` 정적 매칭) 표시
- 서울 지역구별 법정동 코드(`seoul_lawd_codes.json`) 내장

## 기술 스택

| 레이어 | 사용 기술 |
|--------|-----------|
| 프론트엔드 | 바닐라 HTML/CSS/JS (빌드 불필요) |
| 백엔드 | Cloudflare Pages Functions |
| 데이터 | 국토교통부 공공데이터포털 아파트 실거래가 API |
| 캐싱 | Cloudflare KV (선택) |

## 로컬 실행

```bash
# Cloudflare Pages 로컬 개발 서버 (wrangler 필요)
npx wrangler pages dev . --binding APT_SERVICE_KEY=<your_key>
```

또는 `index.html`을 브라우저에서 바로 열면 됩니다 (API 프록시 없이 UI만 확인).

## 배포 (Cloudflare Pages)

1. 이 저장소를 Cloudflare Pages에 연결
2. **환경 변수** 설정:
   - `APT_SERVICE_KEY` — 공공데이터포털에서 발급받은 서비스키 (URL 인코딩된 원본값, `%2B` 등 포함)
3. (선택) **KV 네임스페이스** 생성 후 바인딩 이름 `APT_CACHE`로 연결

## API 엔드포인트

```
GET /api/apt-trade?lawdCd={5자리}&dealYmd={YYYYMM}
```

| 파라미터 | 형식 | 예시 |
|----------|------|------|
| `lawdCd` | 5자리 숫자 | `11680` (강남구) |
| `dealYmd` | YYYYMM | `202605` |

## 세대수·준공년도 데이터

국토교통부 아파트매매 실거래자료 API에는 세대수 항목이 없어, K-apt(공동주택관리정보시스템)에서 제공하는
전국 단지 기본정보 엑셀(로그인·인증 불필요, `https://www.k-apt.go.kr/web/board/goKaptBasicExcelDownload.do`)을
내려받아 서울 25개구만 추려 `seoul_apt_complex.json`으로 정적 가공해 두었다 (기준일 2026-07-03, 3,174개 단지).
실거래가 API의 단지명(`aptNm`)과 이 파일의 단지명(`kaptName`)을 정규화 후 매칭해 세대수·준공년도를 표시한다.
동명 단지가 있을 경우 법정동(`umdNm`/`dong`)이 같은 쪽을 우선한다. 표기 차이가 큰 단지는 매칭되지 않아 "-"로 표시될 수 있다.
스냅샷은 시간이 지나면 낡으므로, 최신 단지가 반영되지 않으면 K-apt에서 파일을 다시 받아 재가공하면 된다.

## 라이선스

MIT
