# 우리집 찾기 출시 기록 / 운영

## 배포 구조

- 운영 주소: https://excelzip.pages.dev/ (구매 화면), `/buy.html`도 동일 기능.
- 기존 엑셀 화면: `/excel.html`. 기존 거래·뉴스 Functions 유지.
- GitHub `uhdh/autumation1`의 `master` → 기존 Cloudflare Pages 연결.
- 빌드: `node --test && node scripts/build-site.mjs`, 출력 `dist`.
- 배포 허용 목록만 복사한다. 원천 캐시, 기획 문서, 테스트, 자격 증명은 배포하지 않는다.

## 데이터 갱신

GitHub Actions `Refresh public apartment data`가 매일 21:17 UTC(다음날 06:17 KST) 실행되며 수동 실행도 가능하다. GitHub 스케줄은 지연될 수 있다.

1. 서울시 매매·전세·철도 자료 수집 및 집계.
2. K-apt 최신 공개 게시물의 단지 기본정보 다운로드·변환.
3. 단지 지번/코드 연결, 수도권 역사마스터 갱신.
4. 테스트, 데이터 크기·날짜·유일성 검사, 공개 파일 구성 검사.
5. 모두 성공한 경우에만 정적 자료를 커밋·푸시. 기존 Pages 연동으로 배포.
6. `/release.json`의 커밋이 갱신 커밋과 일치하는지 최대 10분 확인.

수집·검증 실패 시 커밋하지 않아 운영 스냅샷이 유지된다. 배포 확인 실패는 Actions 실패로 남는다. GitHub Actions 알림은 계정의 알림 설정에 따른다. 알림 수신자를 임의로 추가하지 않았다. 거래 자료는 7일 초과 시 화면에 경과일을 표시한다.

```sh
gh workflow run refresh-data.yml
gh run list --workflow refresh-data.yml --limit 5
node --test
node scripts/validate-data.mjs
node scripts/build-site.mjs
```

새 수집을 로컬에서 실행하려면 Python 3.12, requests 2.32.5, openpyxl 3.1.5 및 Node 22를 사용한다. 원본은 `.data-cache`에 저장한다.

## 장애 대응 / 되돌리기

1. Cloudflare Pages `excelzip` → Deployments에서 마지막 정상 **production** 배포를 선택해 Rollback.
2. 원인 수정 전에는 Actions 갱신 workflow를 일시 중지해 다음 데이터 커밋으로 다시 배포되지 않도록 한다.
3. 코드 문제가 있으면 문제 커밋을 `git revert`하고 테스트 후 푸시한다. 강제 푸시로 이력을 지우지 않는다.
4. `/`, `/buy`, `/excel`, `/about`, `/privacy`, `/release.json`, API의 오류 응답, 데이터 수집일을 재확인한다.

출시 전 기존 production 배포: `fe92fb70-6513-4319-a544-c1fe7adb3d0a` (소스 `3d657ca`). 이 버전으로 되돌리면 기존 엑셀 화면으로 돌아간다. 앱 출시 후에는 최신 정상 구매 화면 production 배포를 우선 선택한다. Preview 배포는 rollback 대상으로 쓸 수 없다.

## 검증과 범위

- Node 19개 테스트: 거래 페이징·취소, 가격·상환, 지역/지번 충돌, 지도 좌표, 조건 교집합, 상승률·전세가율·자체 상대평가, 철도 경로, 배포 자료 무결성.
- 기본 0~10억: 2,508개 단지·면적 중 1,441개 좌표 연결, 지도 793개 단지. 이전 엄격 이름 매칭은 284개 연결/160개 지도 단지였다.
- 7~9억 → 1,000세대 이상 → 역 500m → 초품아 참고: 지도 382 → 66 → 33 → 4개 단지. 연식 추가·빈 결과·해제·잘못된 가격 범위·상세·비교 확인.
- 모바일 브라우저 390px에서 가로 넘침 없음. Preview Lighthouse 접근성/권장사항 100. Preview는 Cloudflare 기본 검색 차단으로 SEO 점수가 낮으며 운영 주소에서 재확인한다.
- 실제 Android 삼성 인터넷에서 공개 Preview 접근·터치 검증. 로컬 포트 연결은 정책 차단으로 사용하지 않음. `/buy` rewrite가 Pages HTML 정규화와 충돌하는 반복 이동을 실기기에서 발견해 제거.

초품아는 비공식 참고목록으로 통학구역 보장이 아니다. 역세권은 수도권 역 중심까지 직선거리이며, 출퇴근 **시간** 그래프는 여전히 1~8호선 일부다. 상대평가는 2024/2025 Q4 기반 자체 산식이며 QuantLab의 전체 로직 복제가 아니다. 미등록 소규모 단지·모호한 주소는 목록에 남지만 지도나 해당 조건에서 누락될 수 있다.
