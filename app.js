import {
  HandLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

// landmark indices (MediaPipe hand model)
const THUMB_TIP = 4;
const WRIST = 0;
const MIDDLE_MCP = 9;
const FINGERS = {
  index: { tip: 8 },
  middle: { tip: 12 },
  ring: { tip: 16 },
  pinky: { tip: 20 },
};
// MediaPipe handedness ("Left"/"Right") matches the user's real hand once
// the video is CSS-mirrored for selfie view (see #camera-wrap).
const HANDS = {
  left: { category: "Left", title: "왼손" },
  right: { category: "Right", title: "오른손" },
};
const CATEGORY_TO_HAND = { Left: "left", Right: "right" };
// fingers whose label is a fixed image, shown only while pinched (no word, no speech)
const SPECIAL_LABELS = { left: { index: "ssafy.png" } };
// while the special image is pinched, it grows/shrinks as the hand moves closer to/
// farther from the camera, relative to its distance when the pinch started
// (hand span in the normalized landmark frame grows as the hand nears the camera)
const PROXIMITY_MIN_SCALE = 0.6;
const PROXIMITY_MAX_SCALE = 2.2;

const els = {
  setupScreen: document.getElementById("setup-screen"),
  cameraScreen: document.getElementById("camera-screen"),
  startBtn: document.getElementById("start-btn"),
  backBtn: document.getElementById("back-btn"),
  status: document.getElementById("setup-status"),
  voiceSelect: document.getElementById("voice-select"),
  video: document.getElementById("video"),
  canvas: document.getElementById("overlay"),
  cameraWrap: document.getElementById("camera-wrap"),
  labels: document.getElementById("labels"),
  inappOverlay: document.getElementById("inapp-overlay"),
  copyLinkBtn: document.getElementById("copy-link-btn"),
  gestureBanner: document.getElementById("gesture-banner"),
  beautyToggle: document.getElementById("beauty-toggle"),
  muteToggle: document.getElementById("mute-toggle"),
};
const ctx = els.canvas.getContext("2d");

let handLandmarker = null;
let stream = null;
let rafId = null;
let isMuted = false;
const words = {}; // words[hand][finger] = string
const fingerState = {}; // fingerState[hand][finger] = { pinched, lastSpeakAt }
Object.keys(HANDS).forEach((h) => {
  words[h] = {};
  fingerState[h] = {};
  Object.keys(FINGERS).forEach((f) => (fingerState[h][f] = { pinched: false, lastSpeakAt: 0, baseScale: null }));
});

// ---------- Thumbs-up gesture ----------
const THUMBS_UP_ON_FRAMES = 3;
const THUMBS_UP_OFF_FRAMES = 5;
const gestureState = {}; // gestureState[hand] = { onStreak, offStreak, active }
Object.keys(HANDS).forEach((h) => {
  gestureState[h] = { onStreak: 0, offStreak: 0, active: false };
});

// thumb pointing clearly upward while the other four fingers are curled into a fist
function isThumbsUp(lm) {
  const scale = dist(lm[WRIST], lm[MIDDLE_MCP]) || 0.001;
  const thumbUp = lm[2].y - lm[THUMB_TIP].y > scale * 0.35;
  const curled = Object.values(FINGERS).every((f) => lm[f.tip].y > lm[f.tip - 2].y);
  return thumbUp && curled;
}

// ---------- Font toggle ----------
function applyFont(font) {
  document.body.classList.toggle("font-pretendard", font === "pretendard");
  document.querySelectorAll(".font-toggle-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.font === font);
  });
  localStorage.setItem("newhandtypo-font", font);
}
document.querySelectorAll(".font-toggle-btn").forEach((btn) => {
  btn.addEventListener("click", () => applyFont(btn.dataset.font));
});
applyFont(localStorage.getItem("newhandtypo-font") || "paperlogy");

// ---------- In-app browser detection ----------
function isInAppBrowser() {
  const ua = navigator.userAgent || "";
  return /Instagram|FBAN|FBAV|KAKAOTALK|NAVER|Line\/|; wv\)/i.test(ua);
}
if (isInAppBrowser()) {
  els.inappOverlay.classList.remove("hidden");
}
els.copyLinkBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    els.copyLinkBtn.textContent = "복사 완료!";
  } catch {
    window.prompt("주소를 복사하세요:", location.href);
  }
});

// ---------- Voice list ----------
// Korean TTS voice packs don't expose a gender field, so match known male
// voice names (Windows/macOS/Chrome) to pick a sensible default.
const MALE_VOICE_HINTS = /InJoon|Minsu|Jinho|남성|male/i;
// stock female Korean voices read a bit high/thin by default; nudge pitch down
const FEMALE_VOICE_PITCH = 0.85;

// pre-recorded male voice clip for "싸피" — device TTS voice packs vary (iOS often
// has no Korean male voice installed at all), so this is baked in instead of relying
// on speechSynthesis.
const ssafyAudio = new Audio("ssafy-voice.mp3");
ssafyAudio.preload = "auto";

// the recorded clip is quieter than natural speech, and HTMLMediaElement.volume
// caps at 1.0, so route it through a GainNode to amplify past that ceiling.
let ssafyAudioCtx = null;
let ssafyGainWired = false;
function wireSsafyGain() {
  if (ssafyGainWired) return;
  try {
    ssafyAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = ssafyAudioCtx.createMediaElementSource(ssafyAudio);
    const gain = ssafyAudioCtx.createGain();
    gain.gain.value = 1.5;
    source.connect(gain).connect(ssafyAudioCtx.destination);
    ssafyGainWired = true;
  } catch {
    // Web Audio unavailable — fall back to the unboosted element playback
  }
}

function playSsafyAudio() {
  if (isMuted) return;
  ssafyAudio.currentTime = 0;
  ssafyAudio.play().catch(() => {});
}

function populateVoices() {
  const voices = speechSynthesis.getVoices();
  if (!voices.length) return;
  const korean = voices.filter((v) => v.lang && v.lang.toLowerCase().startsWith("ko"));
  const list = korean.length ? korean : voices;
  els.voiceSelect.innerHTML = "";
  list.forEach((v, i) => {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = `${v.name} (${v.lang})`;
    els.voiceSelect.appendChild(opt);
  });
  els.voiceSelect.dataset.pool = "loaded";
  populateVoices.list = list;

  const maleIdx = list.findIndex((v) => MALE_VOICE_HINTS.test(v.name));
  if (maleIdx !== -1) els.voiceSelect.value = maleIdx;
}
populateVoices();
if (speechSynthesis.onvoiceschanged !== undefined) {
  speechSynthesis.onvoiceschanged = populateVoices;
}

function speak(text, voiceOverride) {
  if (!text || isMuted) return;
  // don't cancel() here: with two hands, a pinch on one hand shouldn't cut
  // off a word just triggered by the other hand. Utterances queue instead.
  if (speechSynthesis.pending && speechSynthesis.speaking) return; // avoid unbounded queue buildup
  const utter = new SpeechSynthesisUtterance(text);
  const list = populateVoices.list || [];
  const voice = voiceOverride || list[Number(els.voiceSelect.value)];
  if (voice) {
    utter.voice = voice;
    utter.lang = voice.lang;
    if (!MALE_VOICE_HINTS.test(voice.name)) utter.pitch = FEMALE_VOICE_PITCH;
  } else {
    utter.lang = "ko-KR";
  }
  utter.rate = 1;
  speechSynthesis.speak(utter);
}

// ---------- Setup -> Start ----------
els.startBtn.addEventListener("click", async () => {
  // iOS Safari (and some mobile browsers) only unlock SpeechSynthesis inside
  // a direct user-gesture handler. Later speak() calls happen from the pinch
  // detection loop (not a gesture), so they'd silently no-op without this.
  try {
    const unlock = new SpeechSynthesisUtterance(" ");
    unlock.volume = 0;
    speechSynthesis.speak(unlock);
  } catch {}
  // same gesture-unlock requirement applies to <audio> / AudioContext on iOS Safari
  wireSsafyGain();
  if (ssafyAudioCtx?.state === "suspended") ssafyAudioCtx.resume().catch(() => {});
  ssafyAudio
    .play()
    .then(() => {
      ssafyAudio.pause();
      ssafyAudio.currentTime = 0;
    })
    .catch(() => {});

  els.status.textContent = "";
  Object.keys(HANDS).forEach((h) => {
    Object.keys(FINGERS).forEach((f) => {
      if (SPECIAL_LABELS[h]?.[f]) return; // image slot, no word to read
      const input = document.getElementById(`word-${h}-${f}`);
      words[h][f] = input.value.trim(); // empty string = finger stays unlabeled
    });
  });
  isMuted = els.muteToggle.checked;
  els.video.classList.toggle("beauty-on", els.beautyToggle.checked);

  els.startBtn.disabled = true;
  els.status.style.color = "#8fd";
  els.status.textContent = "카메라 권한을 확인하는 중...";

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });
  } catch (err) {
    els.status.style.color = "#ff8080";
    els.status.textContent = "카메라 접근이 거부되었어요. 브라우저 설정에서 카메라 권한을 허용해주세요.";
    els.startBtn.disabled = false;
    return;
  }

  els.status.textContent = "손 인식 모델을 불러오는 중...";
  try {
    if (!handLandmarker) {
      const vision = await FilesetResolver.forVisionTasks(WASM_URL);
      handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
        runningMode: "VIDEO",
        numHands: 2,
      });
    }
  } catch (err) {
    els.status.style.color = "#ff8080";
    els.status.textContent = "모델을 불러오지 못했어요. 네트워크 상태를 확인하고 다시 시도해주세요.";
    els.startBtn.disabled = false;
    stream.getTracks().forEach((t) => t.stop());
    return;
  }

  els.video.srcObject = stream;
  await els.video.play();

  els.setupScreen.classList.add("hidden");
  els.cameraScreen.classList.remove("hidden");

  Object.keys(HANDS).forEach((h) => {
    Object.keys(FINGERS).forEach((f) => {
      if (SPECIAL_LABELS[h]?.[f]) return; // image slot keeps its <img>, no text
      document.getElementById(`label-${h}-${f}`).textContent = words[h][f];
    });
  });

  els.startBtn.disabled = false;
  resizeCanvas();
  rafId = requestAnimationFrame(detectLoop);
});

els.backBtn.addEventListener("click", stopCamera);

function stopCamera() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  speechSynthesis.cancel();
  els.cameraScreen.classList.add("hidden");
  els.setupScreen.classList.remove("hidden");
}

window.addEventListener("resize", resizeCanvas);
window.addEventListener("orientationchange", () => setTimeout(resizeCanvas, 200));

function resizeCanvas() {
  const rect = els.cameraWrap.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  els.canvas.width = rect.width * dpr;
  els.canvas.height = rect.height * dpr;
  els.canvas.style.width = rect.width + "px";
  els.canvas.style.height = rect.height + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// ---------- Detection loop ----------
function detectLoop() {
  if (!stream) return;
  const now = performance.now();
  const rect = els.cameraWrap.getBoundingClientRect();

  if (els.video.videoWidth > 0) {
    const result = handLandmarker.detectForVideo(els.video, now);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const toPixel = (point) =>
      mapToDisplay(point, els.video.videoWidth, els.video.videoHeight, rect.width, rect.height);

    const seenHands = new Set();
    (result.landmarks || []).forEach((lm, i) => {
      const category = result.handedness?.[i]?.[0]?.categoryName;
      const handKey = CATEGORY_TO_HAND[category];
      if (!handKey || seenHands.has(handKey)) return; // ignore unknown/duplicate
      seenHands.add(handKey);
      drawFingertipDots(lm, toPixel);
      updateFingers(handKey, lm, toPixel, rect, now);
      updateGesture(handKey, lm);
    });

    Object.keys(HANDS).forEach((h) => {
      const handVisible = seenHands.has(h);
      Object.keys(FINGERS).forEach((f) => {
        if (SPECIAL_LABELS[h]?.[f]) {
          // image slot: visibility follows pinch state, not hand presence,
          // but force-hide if the hand disappears mid-pinch
          if (!handVisible) {
            fingerState[h][f].pinched = false;
            document.getElementById(`label-${h}-${f}`).classList.remove("shown");
          }
          return;
        }
        const show = handVisible && Boolean(words[h][f]);
        document.getElementById(`label-${h}-${f}`).style.display = show ? "block" : "none";
      });
      if (!handVisible) {
        const gs = gestureState[h];
        gs.onStreak = 0;
        gs.offStreak = 0;
        gs.active = false;
      }
    });

    const anyThumbsUp = Object.values(gestureState).some((g) => g.active);
    els.gestureBanner.classList.toggle("shown", anyThumbsUp);
  }

  rafId = requestAnimationFrame(detectLoop);
}

// object-fit: cover mapping from normalized landmark -> displayed pixel
function mapToDisplay(point, videoW, videoH, containerW, containerH) {
  const scale = Math.max(containerW / videoW, containerH / videoH);
  const dispW = videoW * scale;
  const dispH = videoH * scale;
  const offsetX = (containerW - dispW) / 2;
  const offsetY = (containerH - dispH) / 2;
  return {
    x: point.x * dispW + offsetX,
    y: point.y * dispH + offsetY,
  };
}

const DOT_LANDMARKS = [THUMB_TIP, ...Object.values(FINGERS).map((f) => f.tip)];

function drawFingertipDots(lm, toPixel) {
  DOT_LANDMARKS.forEach((idx) => {
    const px = toPixel(lm[idx]);
    ctx.beginPath();
    ctx.arc(px.x, px.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = "#ff3b30";
    ctx.fill();
  });
}

function updateFingers(handKey, lm, toPixel, rect, now) {
  const thumbTip = lm[THUMB_TIP];
  const handScale = dist(lm[WRIST], lm[MIDDLE_MCP]) || 0.001;
  const pinchOn = handScale * 0.45;
  const pinchOff = handScale * 0.65;

  Object.entries(FINGERS).forEach(([key, cfg]) => {
    const tip = lm[cfg.tip];
    const d = dist(thumbTip, tip);
    const state = fingerState[handKey][key];
    const label = document.getElementById(`label-${handKey}-${key}`);

    const special = SPECIAL_LABELS[handKey]?.[key];
    if (!state.pinched && d < pinchOn) {
      state.pinched = true;
      if (special) {
        state.baseScale = handScale;
        label.classList.add("shown");
        if (now - state.lastSpeakAt > 600) {
          state.lastSpeakAt = now;
          playSsafyAudio();
        }
      } else if (now - state.lastSpeakAt > 600) {
        state.lastSpeakAt = now;
        speak(words[handKey][key]);
        label.classList.add("active");
      }
    } else if (state.pinched && d > pinchOff) {
      state.pinched = false;
      if (special) state.baseScale = null;
      label.classList.remove(special ? "shown" : "active");
    }

    if (special && state.pinched) {
      const ratio = handScale / (state.baseScale || handScale);
      const zoom = Math.min(PROXIMITY_MAX_SCALE, Math.max(PROXIMITY_MIN_SCALE, ratio));
      label.style.setProperty("--proximity-scale", zoom.toFixed(3));
    }

    const px = toPixel(tip);
    const mirroredX = rect.width - px.x;
    label.style.left = mirroredX + "px";
    label.style.top = px.y - 34 + "px";
  });
}

function updateGesture(handKey, lm) {
  const gs = gestureState[handKey];
  if (isThumbsUp(lm)) {
    gs.onStreak++;
    gs.offStreak = 0;
    if (gs.onStreak >= THUMBS_UP_ON_FRAMES) gs.active = true;
  } else {
    gs.offStreak++;
    gs.onStreak = 0;
    if (gs.offStreak >= THUMBS_UP_OFF_FRAMES) gs.active = false;
  }
}

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z || 0) - (b.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// create label DOM elements once, per hand per finger.
// Color is keyed by finger (not hand) so the same finger reads as the same
// pastel color on both hands.
Object.keys(HANDS).forEach((handKey) => {
  Object.keys(FINGERS).forEach((fingerKey) => {
    const div = document.createElement("div");
    div.id = `label-${handKey}-${fingerKey}`;
    const special = SPECIAL_LABELS[handKey]?.[fingerKey];
    if (special) {
      div.className = `finger-label finger-label-special finger-${fingerKey}`;
      const img = document.createElement("img");
      img.src = special;
      img.alt = "";
      div.appendChild(img);
    } else {
      div.className = `finger-label finger-${fingerKey}`;
      div.style.display = "none";
    }
    els.labels.appendChild(div);
  });
});
