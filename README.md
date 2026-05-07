# Δ DeltaForm Check v2 — 핸드폰 PWA (js-aruco2 기반)

> 마커 인식 검사 도구 — 현장에서 핸드폰으로 사진을 즉시 검사

이전 버전(OpenCV.js)은 ArUco 모듈 호환성 문제로 검출 실패가 잦아,
**js-aruco2** (ArUco 전용 순수 JS 라이브러리)로 재작성했습니다.

---

## 주요 변경점 (v1 → v2)

- ❌ OpenCV.js (9MB, ArUco 호환성 문제) → ✅ **js-aruco2 (~50KB, 안정적)**
- 첫 로드 속도 100배 빨라짐
- DICT_4X4_50 등 OpenCV 사전을 모두 지원 (커스텀 사전 주입)

---

## 폴더 구조 (최종)

```
check/
├── index.html              ← 메인 화면
├── style.css               ← 다크 테마
├── app.js                  ← 검출 + 검사 로직
├── aruco_dicts_data.js     ← OpenCV 사전 데이터 (DICT_4X4_50 등 9개)
├── manifest.json           ← PWA 설정
├── sw.js                   ← Service Worker
├── icon-192.png            ← 앱 아이콘
├── icon-512.png            ← 앱 아이콘 (큰 사이즈)
├── cv.js                   ← (수동 다운로드 필요) js-aruco2 의존성
└── aruco.js                ← (수동 다운로드 필요) js-aruco2 메인
```

---

## 1. js-aruco2 라이브러리 다운로드 (한 번만)

이 폴더에 **`cv.js`** 와 **`aruco.js`** 두 파일을 두어야 합니다. 라이센스(MIT)
+ 깃허브 외부 저장소라 따로 받습니다.

### 받는 방법

PC 브라우저로 아래 두 URL을 각각 열고 **우클릭 → 다른 이름으로 저장**:

1. **cv.js**: https://raw.githubusercontent.com/damianofalcioni/js-aruco2/master/src/cv.js
2. **aruco.js**: https://raw.githubusercontent.com/damianofalcioni/js-aruco2/master/src/aruco.js

저장 시 파일명을 그대로 (`cv.js`, `aruco.js`) 두고, 이 `check/` 폴더에 둡니다.

### 또는 명령줄

```bash
curl -L -o cv.js https://raw.githubusercontent.com/damianofalcioni/js-aruco2/master/src/cv.js
curl -L -o aruco.js https://raw.githubusercontent.com/damianofalcioni/js-aruco2/master/src/aruco.js
```

각 파일 크기가 정상이면 (cv.js 약 30KB, aruco.js 약 50KB) 준비 완료.

---

## 2. GitHub Pages 배포 (HTTPS 필수)

### 기존 v1 저장소가 있다면

기존 저장소에 새 파일들로 **덮어쓰기**:
1. 기존 GitHub 저장소 접속
2. 옛 `opencv.js` 파일 **삭제** (더 이상 필요 없음, 9MB 절약)
3. 이 `check/` 폴더의 새 파일들 모두 업로드 (덮어쓰기)
   - `index.html`, `style.css`, `app.js`, `aruco_dicts_data.js`,
     `manifest.json`, `sw.js`, `icon-192.png`, `icon-512.png`,
     **`cv.js`, `aruco.js`** (다운로드 받은 라이브러리)
4. Commit changes
5. 1~2분 후 Pages 자동 재빌드

### 새로 시작한다면

1. GitHub 새 Public 저장소 생성 (예: `deltaform-check`)
2. 모든 파일 업로드 (10개 파일)
3. Settings → Pages → Branch `main` + `/ (root)` → Save
4. URL 받기: `https://본인ID.github.io/deltaform-check/`

---

## 3. 핸드폰 설치

1. **Android Chrome**으로 위 URL 접속
2. 첫 로드: **5~10초** (이전 버전과 비교 안 될 정도로 빠름)
3. 우측 상단 메뉴 ⋮ → **"홈 화면에 추가"**
4. 홈 화면에 Δ 아이콘 생성

이후 완전 오프라인 동작.

---

## 4. 사용

1. 홈 화면 Δ 아이콘 탭
2. 사전 / 예상 ID / 예상 마커 개수 / Hamming 모드 설정
3. **"📷 사진 촬영"** 또는 **"🖼️ 갤러리에서 선택"**
4. 1~2초 후 결과:
   - ✅ / ⚠️ / ❌ 종합 등급
   - 사진 위 마커 박스 + ID 라벨
   - 마커별 측정값 + 권장 조치

---

## 5. Hamming 모드 설명

| 모드 | 용도 |
|---|---|
| 기본 | 일반적인 상황 |
| 엄격 | False positive 최소화 (확실한 마커만) |
| 관대 | 작거나 흐린 마커도 시도 (false positive 늘 수 있음) |

처음엔 기본으로 시도, 검출 실패 시 관대로 재시도.

---

## 6. 지원 사전

OpenCV의 9개 사전 지원:
- DICT_4X4_50, _100, _250
- DICT_5X5_50, _100
- DICT_6X6_50, _250
- DICT_7X7_50
- DICT_ARUCO_ORIGINAL

모두 `aruco_dicts_data.js`에 OpenCV에서 추출한 코드가 들어 있어 100% 호환.

---

## 7. 자주 묻는 문제

**Q. 화면 상단에 빨간 "js-aruco2 라이브러리 누락" 박스가 뜸**
→ `cv.js` 또는 `aruco.js` 파일이 폴더에 없습니다. 1번 단계 다시 확인.

**Q. "마커 검출 실패"**
→ Hamming 모드를 "관대"로 변경하고 재시도. 그래도 안 되면 마커가 너무 작거나 흐림.

**Q. 첫 로드도 안 끝남**
→ HTTPS인지 확인. GitHub Pages는 자동 HTTPS. HTTP에서는 Service Worker가 동작 안 함.

**Q. v1에서 캐싱된 이전 버전이 보임**
→ 핸드폰 Chrome 메뉴 → 설정 → 사이트 설정 → 모든 사이트 → 해당 URL → "데이터 삭제". 그 후 재접속.
   또는 Chrome에서 해당 페이지 우측상단 ⋮ → "방문 기록"에서 사이트 데이터 지우기.

---

## 8. v1 기존 사용자 마이그레이션 체크리스트

- [ ] GitHub 저장소에서 `opencv.js` 삭제
- [ ] 새 파일들로 모두 교체
- [ ] `cv.js`, `aruco.js` 두 파일 추가 업로드
- [ ] 핸드폰에서 캐시 삭제 후 재접속
- [ ] 홈 화면 아이콘은 그대로 유지됨

---

Δ **DeltaForm Check** v2.0 · Mobile PWA · Powered by js-aruco2
