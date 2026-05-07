# Δ DeltaForm Check — 핸드폰 PWA

> 마커 인식 검사 도구 — 현장에서 핸드폰으로 사진을 즉시 검사해
> DeltaForm Pro 분석에 사용 가능한지 확인합니다.

완전 오프라인 동작 (첫 실행 후). Android Chrome 권장.

---

## 폴더 구조

```
check/
├── index.html         ← 메인 화면
├── style.css          ← 다크 테마
├── app.js             ← 검출 + 검사 로직
├── aruco_dicts.js     ← ArUco 사전 매핑
├── manifest.json      ← PWA 설정
├── sw.js              ← Service Worker (오프라인)
├── icon-192.png       ← 앱 아이콘
├── icon-512.png       ← 앱 아이콘 (큰 사이즈)
└── opencv.js          ← (수동 다운로드 필요, 약 9MB)
```

---

## 1. OpenCV.js 다운로드 (한 번만)

이 폴더에 `opencv.js` 파일이 들어가야 합니다. 라이센스 + 용량 문제로 코드와 별도 배포.

### 받는 방법

1. https://docs.opencv.org/4.x/opencv.js 접속
2. 페이지 통째 저장 (Ctrl+S 또는 우클릭 → 다른 이름으로 저장)
3. 파일명을 `opencv.js`로 (다른 이름으로 받았으면 수정)
4. 이 폴더(`check/`)에 둠

또는 명령줄로:
```bash
curl -L -o opencv.js https://docs.opencv.org/4.x/opencv.js
# 또는
wget https://docs.opencv.org/4.x/opencv.js
```

확인: 파일 크기가 약 8~10MB. ArUco 모듈이 포함된 빌드여야 함 (4.x 공식 빌드는 포함됨).

---

## 2. GitHub Pages 배포 (HTTPS 필수)

PWA의 카메라 API는 HTTPS에서만 동작. GitHub Pages가 무료로 자동 HTTPS 제공.

### 단계

1. **GitHub 계정** 로그인 (없으면 가입)
2. 새 저장소(repository) 생성:
   - 이름: `deltaform-check` (자유)
   - **Public** (Pages는 Public이면 무료)
3. 이 `check/` 폴더의 모든 파일을 저장소에 업로드:
   - 웹 GUI: "Add file" → "Upload files" → 드래그
   - 또는 git push
4. 저장소 **Settings** → **Pages**:
   - Source: `Deploy from a branch`
   - Branch: `main` / 폴더 `/ (root)`
   - Save
5. 1~2분 후 URL 생성: `https://본인GitHubID.github.io/deltaform-check/`
6. 페이지 들어가서 작동 확인

### 비공개로 하고 싶다면

GitHub Pages는 Pro 계정($4/월)에서 Private 저장소도 지원. 또는 다른 방법:
- **Cloudflare Pages** — 무료 + Private 가능
- **Netlify** — 무료 + 가능
- **회사 내부 웹서버** — IT팀과 협의

---

## 3. 핸드폰에 "앱처럼" 설치

1. **Android Chrome**으로 위 URL 접속
2. 첫 로드: 약 30초~1분 (OpenCV.js 9MB 다운로드)
3. 사용 가능해지면, 우측 상단 메뉴 ⋮ → **"홈 화면에 추가"**
4. 홈 화면에 Δ 아이콘이 생김 — 일반 앱처럼 동작

이후:
- 인터넷 끊겨도 작동 (Service Worker가 캐싱)
- 회사 Wi-Fi 없어도 OK
- 외부에 사진 전송 안 됨 (완전 클라이언트 처리)

---

## 4. 사용 방법

1. 홈 화면 Δ 아이콘 탭
2. 사전 / 예상 ID / 예상 마커 개수 설정 (DeltaForm Pro와 동일 값)
3. **"📷 사진 촬영"** — 카메라가 열리고 사진 한 장 찍기
   또는 **"🖼️ 갤러리에서 선택"** — 이미 찍은 사진 선택
4. 1~3초 후 결과 화면:
   - ✅ 사용 가능 / ⚠️ 조건부 / ❌ 부적합
   - 검출된 마커 시각화 (초록/노랑/빨강 박스)
   - 마커별 측정값 + 문제 목록 + 권장 조치
5. 통과하면 본 촬영 진행, 실패면 안내 따라 재시도

---

## 5. 검사 항목

| 항목 | 통과 기준 |
|---|---|
| 마커 검출 | 지정 사전으로 검출됨 |
| 마커 ID | 예상 ID 목록에 포함 |
| 마커 크기 | 한 변 ≥ 80px (사진 가로의 5%+) |
| 변 비율 | max/min ≤ 1.3 (정사각형에 가까움) |
| 비스듬함 | 추정 각도 ≤ 50° |
| 빛 반사 | 흰 영역 클리핑 ≤ 10% |
| 어두움 | 검은 영역 ≥120 픽셀 ≤ 30% |
| 선명도 | 라플라시안 분산 ≥ 150 |

---

## 6. 한계

- **iOS Safari의 PWA는 일부 제한**됨. Android Chrome 우선 권장.
- OpenCV.js의 모바일 성능 — 4080×3060 사진 한 장에 1~3초 처리 (단말기 따라 다름).
- 첫 실행 시 OpenCV.js 다운로드 필요 (인터넷 1회 필수).
- ArUco 모듈이 포함된 OpenCV.js 빌드 사용 필수 (공식 4.x 빌드 OK).

---

## 7. 자주 묻는 문제

**Q. "OpenCV 라이브러리 로딩 중..." 에서 멈춤**
→ `opencv.js` 파일이 폴더에 없거나, 손상. 다시 다운로드.

**Q. 사진 선택해도 검출 결과가 이상함**
→ 사전 선택을 DeltaForm Pro에서 사용한 것과 동일하게 (예: `DICT_4X4_50`).

**Q. 카메라 버튼 눌러도 카메라 안 열림**
→ HTTPS인지 확인. HTTP에서는 카메라 권한 안 줌. GitHub Pages 또는 다른 HTTPS 호스팅 사용.

**Q. 처리가 매우 느림**
→ 사진 해상도가 너무 큼. 카메라 설정에서 해상도 낮추거나, 4080×3060 정도면 정상 (2~3초).

**Q. 오프라인에서 동작 안 함**
→ 첫 실행 후 Service Worker가 캐싱하는데, 첫 실행 자체는 인터넷 필요. 한 번 정상 실행한 후엔 오프라인 OK.

---

Δ **DeltaForm Check** v1.0 · Mobile PWA · Powered by OpenCV.js
