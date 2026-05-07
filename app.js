// ===========================================================================
// DeltaForm Check — main app logic
// ===========================================================================

let cvLoaded = false;
let lastImageBitmap = null;

// OpenCV.js 로드 완료 콜백
window.cvReady = function () {
  // OpenCV.js 내부 초기화 대기
  if (typeof cv !== "undefined") {
    if (cv.getBuildInformation) {
      onCvReady();
    } else {
      // cv 객체는 있으나 wasm 초기화 전 — onRuntimeInitialized 사용
      cv['onRuntimeInitialized'] = onCvReady;
    }
  }
};

function onCvReady() {
  cvLoaded = true;
  document.getElementById("loading").classList.add("hidden");
  document.getElementById("ready").classList.remove("hidden");
  console.log("OpenCV.js ready, version:", cv.getBuildInformation ? "loaded" : "?");
}

// Fallback: opencv가 onload로 호출 안 했을 때
window.addEventListener("load", () => {
  setTimeout(() => {
    if (!cvLoaded && typeof cv !== "undefined") {
      if (cv.Mat) onCvReady();
      else cv['onRuntimeInitialized'] = onCvReady;
    }
  }, 500);
});

// ===========================================================================
// 화면 전환
// ===========================================================================
function showScreen(name) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(`screen-${name}`).classList.add("active");
  window.scrollTo(0, 0);
}

// ===========================================================================
// 파일 입력 핸들러
// ===========================================================================
document.getElementById("btn-camera").addEventListener("click", () => {
  document.getElementById("file-input").click();
});
document.getElementById("btn-camera-again").addEventListener("click", () => {
  document.getElementById("file-input").click();
});
document.getElementById("btn-gallery").addEventListener("click", () => {
  document.getElementById("file-input-gallery").click();
});
document.getElementById("btn-back").addEventListener("click", () => {
  showScreen("home");
});

document.getElementById("file-input").addEventListener("change", handleFile);
document.getElementById("file-input-gallery").addEventListener("change", handleFile);

async function handleFile(ev) {
  const file = ev.target.files && ev.target.files[0];
  ev.target.value = ""; // reset to allow re-selecting same file
  if (!file) return;

  if (!cvLoaded) {
    alert("OpenCV.js가 아직 로드 중입니다. 잠시 후 다시 시도하세요.");
    return;
  }

  document.getElementById("processing").classList.remove("hidden");

  // 비동기로 약간 양보 — UI가 spinner 표시할 시간
  setTimeout(async () => {
    try {
      const img = await loadImage(file);
      const result = checkImage(img, file.name);
      renderResult(result);
      showScreen("result");
    } catch (e) {
      console.error(e);
      alert("처리 실패: " + e.message);
    } finally {
      document.getElementById("processing").classList.add("hidden");
    }
  }, 50);
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("이미지 로드 실패"));
    };
    img.src = url;
  });
}

// ===========================================================================
// 검사 — OpenCV 호출
// ===========================================================================
function checkImage(htmlImage, filename) {
  const dictName = document.getElementById("dict-select").value;
  const expectedIdsRaw = document.getElementById("expected-ids").value.trim();
  const expectedCount = parseInt(document.getElementById("expected-count").value) || 0;

  let allowedIds = null;
  if (expectedIdsRaw) {
    allowedIds = new Set(
      expectedIdsRaw.split(",").map(x => parseInt(x.trim())).filter(x => !isNaN(x))
    );
    if (allowedIds.size === 0) allowedIds = null;
  }

  // HTMLImage를 canvas → cv.Mat
  const tmpCanvas = document.createElement("canvas");
  tmpCanvas.width = htmlImage.naturalWidth;
  tmpCanvas.height = htmlImage.naturalHeight;
  tmpCanvas.getContext("2d").drawImage(htmlImage, 0, 0);

  const src = cv.imread(tmpCanvas);
  const gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

  // 다중 스케일 검출 — 큰 이미지면 다운스케일도 시도
  let bestCorners = [];
  let bestIds = [];
  let usedDict = dictName;
  let detectedAtScale = 1.0;

  const scales = (Math.max(gray.cols, gray.rows) > 3000) ? [1.0, 0.5] : [1.0];

  for (const scale of scales) {
    const { corners, ids } = detectMarkers(gray, dictName, scale, allowedIds);
    if (ids.length > bestIds.length) {
      bestCorners = corners;
      bestIds = ids;
      detectedAtScale = scale;
    }
  }

  // 못 찾으면 다른 사전 시도 (사전 미스매치 진단)
  let dictMismatchHint = null;
  if (bestIds.length === 0) {
    for (const altDict of Object.keys(window.ARUCO_DICTS)) {
      if (altDict === dictName) continue;
      for (const scale of scales) {
        const { corners, ids } = detectMarkers(gray, altDict, scale, null);
        if (ids.length > 0) {
          dictMismatchHint = altDict;
          bestCorners = corners;
          bestIds = ids;
          usedDict = altDict;
          detectedAtScale = scale;
          break;
        }
      }
      if (dictMismatchHint) break;
    }
  }

  // 마커별 품질 측정
  const markers = [];
  for (let i = 0; i < bestIds.length; i++) {
    const corners = bestCorners[i]; // Float32Array of length 8
    const mc = analyzeMarker(corners, gray, src.cols);
    mc.id = bestIds[i];
    evaluateMarker(mc, src.cols);
    markers.push(mc);
  }

  // 시각화 — RGBA 캔버스용 (src는 RGBA)
  const visMat = src.clone();
  drawDetectionOverlay(visMat, bestCorners, bestIds, markers);

  const result = {
    filename: filename,
    width: src.cols,
    height: src.rows,
    detectedDict: bestIds.length > 0 ? usedDict : null,
    dictMismatch: dictMismatchHint && dictMismatchHint !== dictName ? dictMismatchHint : null,
    requestedDict: dictName,
    detectedAtScale: detectedAtScale,
    markers: markers,
    issues: [],
    overall: "ok",
    summary: "",
    visMat: visMat,
  };

  // 종합 이슈
  if (bestIds.length === 0) {
    result.issues.push({
      severity: "fail", code: "no_detection",
      message: "어떤 사전으로도 마커가 검출되지 않습니다",
      fix: "마커가 사진에 잘 보이는지 / 너무 작거나 흐리지 않은지 확인. " +
           "더 가까이서, 더 정면에서, 더 밝은 환경에서 다시 촬영하세요.",
    });
  } else if (dictMismatchHint) {
    result.issues.push({
      severity: "fail", code: "dict_mismatch",
      message: `지정 사전 '${dictName}'으로는 검출 실패. '${dictMismatchHint}'로는 검출됨`,
      fix: `상단 '사전' 선택을 '${dictMismatchHint}'로 변경하세요.`,
    });
  }

  if (expectedCount > 0 && bestIds.length < expectedCount) {
    const missing = expectedCount - bestIds.length;
    result.issues.push({
      severity: "warn", code: "marker_count_low",
      message: `예상보다 마커가 적게 보임 (${bestIds.length}/${expectedCount}, ${missing}개 누락)`,
      fix: "다른 마커가 가려졌거나 시야 밖. 다양한 각도에서 추가 촬영 권장.",
    });
  }

  // 등급 결정
  let failCount = 0, warnCount = 0;
  const collect = (issues) => {
    for (const i of issues) {
      if (i.severity === "fail") failCount++;
      else if (i.severity === "warn") warnCount++;
    }
  };
  collect(result.issues);
  for (const m of markers) collect(m.issues);

  if (failCount > 0) {
    result.overall = "fail";
    result.summary = `❌ 사용 부적합 — 마커 ${markers.length}개 검출, 치명적 문제 ${failCount}개`;
  } else if (warnCount > 0) {
    result.overall = "warn";
    result.summary = `⚠️ 조건부 사용 가능 — 마커 ${markers.length}개 검출, 경고 ${warnCount}개`;
  } else {
    result.overall = "ok";
    result.summary = `✅ 사용 가능 — 마커 ${markers.length}개 모두 양호`;
  }

  // cleanup
  src.delete();
  gray.delete();

  return result;
}

// ===========================================================================
// 검출 함수
// ===========================================================================
function detectMarkers(gray, dictName, scale, allowedIds) {
  let workMat = gray;
  let needsDelete = false;

  if (scale !== 1.0) {
    workMat = new cv.Mat();
    cv.resize(gray, workMat,
      new cv.Size(Math.round(gray.cols * scale), Math.round(gray.rows * scale)),
      0, 0, cv.INTER_AREA);
    needsDelete = true;
  }

  const dictId = window.ARUCO_DICTS[dictName];
  const dict = cv.getPredefinedDictionary(dictId);
  const params = new cv.aruco_DetectorParameters();
  params.adaptiveThreshWinSizeMin = 5;
  params.adaptiveThreshWinSizeMax = 35;
  params.adaptiveThreshWinSizeStep = 4;
  params.minMarkerPerimeterRate = 0.01;
  params.polygonalApproxAccuracyRate = 0.05;
  params.errorCorrectionRate = 0.4;

  const cornersVec = new cv.MatVector();
  const idsMat = new cv.Mat();

  let detector;
  try {
    detector = new cv.aruco_ArucoDetector(dict, params);
    detector.detectMarkers(workMat, cornersVec, idsMat);
  } catch (e) {
    // older API fallback
    try { cv.detectMarkers(workMat, dict, cornersVec, idsMat, params); }
    catch (e2) { console.warn("detection failed:", e2); }
  }

  const corners = [];
  const ids = [];
  const n = idsMat.rows;
  for (let i = 0; i < n; i++) {
    const id = idsMat.intAt(i, 0);
    if (allowedIds && !allowedIds.has(id)) continue;

    const cornerMat = cornersVec.get(i);
    // cornerMat is 1x4 with CV_32FC2 — 8 floats
    const arr = new Float32Array(8);
    for (let k = 0; k < 4; k++) {
      arr[k * 2]     = cornerMat.data32F[k * 2];
      arr[k * 2 + 1] = cornerMat.data32F[k * 2 + 1];
    }
    if (scale !== 1.0) {
      for (let k = 0; k < 8; k++) arr[k] /= scale;
    }
    corners.push(arr);
    ids.push(id);
    cornerMat.delete();
  }

  cornersVec.delete();
  idsMat.delete();
  if (detector) detector.delete();
  dict.delete();
  params.delete();
  if (needsDelete) workMat.delete();

  return { corners, ids };
}

// ===========================================================================
// 마커 품질 분석
// ===========================================================================
function analyzeMarker(corners, gray, imageWidth) {
  // corners = Float32Array(8) = [x0,y0, x1,y1, x2,y2, x3,y3]
  // 변 길이
  const sides = [];
  for (let i = 0; i < 4; i++) {
    const x1 = corners[i*2],     y1 = corners[i*2+1];
    const x2 = corners[((i+1)%4)*2], y2 = corners[((i+1)%4)*2+1];
    sides.push(Math.hypot(x2-x1, y2-y1));
  }
  const sideAvg = (sides[0]+sides[1]+sides[2]+sides[3]) / 4;
  const sideMin = Math.min(...sides);
  const sideMax = Math.max(...sides);
  const aspectRatio = sideMin > 0 ? sideMax / sideMin : Infinity;

  // 대각선 비 → 각도 추정
  const d1 = Math.hypot(corners[4]-corners[0], corners[5]-corners[1]);
  const d2 = Math.hypot(corners[6]-corners[2], corners[7]-corners[3]);
  const diagRatio = Math.min(d1, d2) > 0 ? Math.max(d1, d2) / Math.min(d1, d2) : Infinity;
  const angleDeg = isFinite(diagRatio)
    ? Math.acos(Math.min(1.0, 1.0 / diagRatio)) * (180 / Math.PI) * 1.5
    : 90;

  // ROI 노출 / 블러
  const xs = [corners[0], corners[2], corners[4], corners[6]];
  const ys = [corners[1], corners[3], corners[5], corners[7]];
  const xMin = Math.max(0, Math.floor(Math.min(...xs)));
  const yMin = Math.max(0, Math.floor(Math.min(...ys)));
  const xMax = Math.min(gray.cols, Math.ceil(Math.max(...xs)));
  const yMax = Math.min(gray.rows, Math.ceil(Math.max(...ys)));
  const w = xMax - xMin, h = yMax - yMin;

  let brightClipPct = 0, darkLiftPct = 0, blurScore = 0;
  if (w > 4 && h > 4) {
    const rect = new cv.Rect(xMin, yMin, w, h);
    const roi = gray.roi(rect);
    const mask = new cv.Mat();
    try {
      cv.threshold(roi, mask, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);

      // 흰/검 픽셀 분리 — 픽셀 값 직접 카운트
      let whiteN = 0, whiteClip = 0;
      let blackN = 0, blackLift = 0;
      const roiData = roi.data;
      const maskData = mask.data;
      for (let i = 0; i < roiData.length; i++) {
        if (maskData[i] === 255) {
          whiteN++;
          if (roiData[i] >= 254) whiteClip++;
        } else {
          blackN++;
          if (roiData[i] >= 120) blackLift++;
        }
      }
      brightClipPct = whiteN > 0 ? (whiteClip / whiteN) * 100 : 0;
      darkLiftPct = blackN > 0 ? (blackLift / blackN) * 100 : 0;

      // 블러 — 라플라시안 분산
      const lap = new cv.Mat();
      cv.Laplacian(roi, lap, cv.CV_64F);
      const meanArr = new cv.Mat(), stdArr = new cv.Mat();
      cv.meanStdDev(lap, meanArr, stdArr);
      const std = stdArr.doubleAt(0, 0);
      blurScore = std * std;
      lap.delete(); meanArr.delete(); stdArr.delete();
    } catch (e) {
      console.warn("ROI analysis error:", e);
    }
    mask.delete();
    roi.delete();
  }

  return {
    id: -1,
    corners: corners,
    sidePx: sideAvg,
    sidePctOfImage: (sideAvg / imageWidth) * 100,
    aspectRatio: aspectRatio,
    angleDeg: angleDeg,
    brightClipPct: brightClipPct,
    darkLiftPct: darkLiftPct,
    blurScore: blurScore,
    issues: [],
  };
}

// ===========================================================================
// 마커 평가 — issues 채움
// ===========================================================================
function evaluateMarker(m, imageWidth) {
  // 픽셀 크기
  if (m.sidePx < 50) {
    m.issues.push({
      severity: "fail", code: "size_too_small",
      message: `마커가 너무 작음 (${Math.round(m.sidePx)}px)`,
      fix: "약 50% 더 가까이 다가가서 다시 촬영. 검출 한계 50px, 권장 100px 이상.",
    });
  } else if (m.sidePx < 80) {
    m.issues.push({
      severity: "warn", code: "size_small",
      message: `마커가 작은 편 (${Math.round(m.sidePx)}px). 검출이 불안정할 수 있음`,
      fix: "약 20~30% 더 가까이서 촬영 권장 (목표 100px+).",
    });
  } else {
    m.issues.push({
      severity: "ok", code: "size_ok",
      message: `크기 양호 (${Math.round(m.sidePx)}px, 사진 가로 ${m.sidePctOfImage.toFixed(1)}%)`,
    });
  }

  // 변 비율
  if (m.aspectRatio > 1.6) {
    m.issues.push({
      severity: "fail", code: "aspect_distorted",
      message: `심하게 변형 (변 비율 ${m.aspectRatio.toFixed(2)})`,
      fix: "마커 받침대 휘어짐 의심. 두꺼운 평면 받침대 + 단단히 부착.",
    });
  } else if (m.aspectRatio > 1.3) {
    m.issues.push({
      severity: "warn", code: "aspect_warn",
      message: `살짝 변형 (변 비율 ${m.aspectRatio.toFixed(2)})`,
      fix: "받침대 평면 상태 확인. 또는 매우 비스듬한 각도에서 촬영됨.",
    });
  }

  // 각도
  if (m.angleDeg > 50) {
    m.issues.push({
      severity: "warn", code: "angle_oblique",
      message: `매우 비스듬 (~${Math.round(m.angleDeg)}°)`,
      fix: "각 마커가 한 번씩은 정면에 가깝게 보이도록 다양한 각도로 촬영.",
    });
  }

  // 노출 — 빛 반사
  if (m.brightClipPct > 25) {
    m.issues.push({
      severity: "fail", code: "overexposed",
      message: `심한 빛 반사 — 흰 영역 ${Math.round(m.brightClipPct)}% 클리핑`,
      fix: "직사광/플래시 반사 가능성. 광원 위치 변경, 무광 인쇄지, 노출 -1 EV 시도.",
    });
  } else if (m.brightClipPct > 10) {
    m.issues.push({
      severity: "warn", code: "bright_warn",
      message: `약간의 빛 반사 (${Math.round(m.brightClipPct)}% 클리핑)`,
      fix: "조명 각도 살짝 조정 권장.",
    });
  }

  // 어두움
  if (m.darkLiftPct > 30) {
    m.issues.push({
      severity: "warn", code: "underexposed",
      message: `어두움/역광 — 검은 영역의 ${Math.round(m.darkLiftPct)}%가 충분히 검지 않음`,
      fix: "조명 추가 또는 노출 +1 EV. 역광이라면 광원이 뒤에 있는지 확인.",
    });
  }

  // 블러
  if (m.blurScore > 0 && m.blurScore < 50) {
    m.issues.push({
      severity: "fail", code: "blur_severe",
      message: `심하게 흐림 (선명도 ${Math.round(m.blurScore)})`,
      fix: "삼각대 사용 또는 더 밝은 환경. 셔터 1/125초 이상.",
    });
  } else if (m.blurScore > 0 && m.blurScore < 150) {
    m.issues.push({
      severity: "warn", code: "blur_warn",
      message: `약간 흐림 (선명도 ${Math.round(m.blurScore)})`,
      fix: "초점 확인 후 재촬영 권장.",
    });
  }
}

// ===========================================================================
// 시각화 오버레이
// ===========================================================================
function drawDetectionOverlay(rgba, cornersList, idsList, markers) {
  for (let i = 0; i < cornersList.length; i++) {
    const c = cornersList[i];
    const mc = markers[i];

    // 마커 등급에 따라 색
    let color;
    const hasFail = mc.issues.some(x => x.severity === "fail");
    const hasWarn = mc.issues.some(x => x.severity === "warn");
    if (hasFail)      color = new cv.Scalar(255, 70, 70, 255);
    else if (hasWarn) color = new cv.Scalar(240, 190, 70, 255);
    else              color = new cv.Scalar(80, 220, 100, 255);

    const pts = [];
    for (let k = 0; k < 4; k++) {
      pts.push(new cv.Point(Math.round(c[k*2]), Math.round(c[k*2+1])));
    }
    // 4변 그리기
    for (let k = 0; k < 4; k++) {
      cv.line(rgba, pts[k], pts[(k+1)%4], color, 5, cv.LINE_AA);
    }
    // ID 라벨
    const cx = (c[0]+c[2]+c[4]+c[6])/4;
    const cy = (c[1]+c[3]+c[5]+c[7])/4;
    const label = `ID:${mc.id}`;
    const org = new cv.Point(Math.round(cx-30), Math.round(cy+10));
    cv.putText(rgba, label, org, cv.FONT_HERSHEY_SIMPLEX, 1.2,
                new cv.Scalar(0, 0, 0, 255), 5, cv.LINE_AA);
    cv.putText(rgba, label, org, cv.FONT_HERSHEY_SIMPLEX, 1.2,
                color, 2, cv.LINE_AA);
  }
}

// ===========================================================================
// 결과 렌더링
// ===========================================================================
function renderResult(result) {
  document.getElementById("result-filename").textContent = result.filename;

  const banner = document.getElementById("result-overall");
  banner.className = `overall-banner ${result.overall}`;
  banner.textContent = result.summary;

  // 캔버스에 시각화 그리기
  const canvas = document.getElementById("result-canvas");
  cv.imshow(canvas, result.visMat);
  result.visMat.delete();

  // 종합 이슈 (사진 전체 단위)
  const summaryDiv = document.getElementById("result-summary");
  let summaryHtml = `<h2>📊 종합</h2>`;
  summaryHtml += `<div class="muted small">크기: ${result.width}×${result.height} · ` +
                  `사전: ${result.detectedDict || "(검출 실패)"}`;
  if (result.detectedAtScale !== 1.0) {
    summaryHtml += ` · 다운스케일 ${result.detectedAtScale}x로 검출`;
  }
  summaryHtml += `</div>`;
  if (result.issues.length > 0) {
    summaryHtml += result.issues.map(formatIssue).join("");
  } else {
    summaryHtml += `<div class="issue ok"><span class="icon">✅</span>` +
                    `<div>모든 검사 통과</div></div>`;
  }
  summaryDiv.innerHTML = summaryHtml;

  // 마커별 카드
  const markersDiv = document.getElementById("result-markers");
  if (result.markers.length === 0) {
    markersDiv.innerHTML = "";
  } else {
    markersDiv.innerHTML = result.markers.map(formatMarkerCard).join("");
  }
}

function formatIssue(issue) {
  const icon = issue.severity === "ok" ? "✅" :
                issue.severity === "warn" ? "⚠️" : "❌";
  let html = `<div class="issue ${issue.severity}">`;
  html += `<span class="icon">${icon}</span><div>${escapeHtml(issue.message)}`;
  if (issue.fix) {
    html += `<span class="fix">→ ${escapeHtml(issue.fix)}</span>`;
  }
  html += `</div></div>`;
  return html;
}

function formatMarkerCard(m) {
  const grade = m.issues.some(x => x.severity === "fail") ? "fail" :
                m.issues.some(x => x.severity === "warn") ? "warn" : "ok";
  const gradeIcon = grade === "ok" ? "✅" : grade === "warn" ? "⚠️" : "❌";
  const gradeLabel = grade === "ok" ? "양호" : grade === "warn" ? "경고" : "부적합";

  let html = `<div class="marker-card">`;
  html += `<div class="header">`;
  html += `<span class="id-label">마커 ID: ${m.id}</span>`;
  html += `<span class="badge ${grade}">${gradeIcon} ${gradeLabel}</span>`;
  html += `</div>`;
  html += `<div class="stats">`;
  html += `${Math.round(m.sidePx)}px (${m.sidePctOfImage.toFixed(1)}%) · `;
  html += `변 비율 ${m.aspectRatio.toFixed(2)} · `;
  html += `각도 ~${Math.round(m.angleDeg)}°`;
  html += `</div>`;
  // 마커별 이슈 목록
  for (const issue of m.issues) {
    html += formatIssue(issue);
  }
  html += `</div>`;
  return html;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
