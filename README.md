# 엑셀아파트 — 아파트 실거래가 위장 사이트

> "회사에서 엑셀 보는 척" 하면서 관심 아파트 단지의 실거래가를 확인하는 웹 서비스

Microsoft Excel 스프레드시트 UI를 위장 껍데기로 사용하고, 실제 콘텐츠는 국토교통부 아파트 실거래가 데이터를 보여줍니다.

## 기능

- Excel 리본 UI 위장 (제목표시줄, 시트 탭 포함)
- 관심 아파트 단지 검색 및 실거래가 조회
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

## 라이선스

MIT
