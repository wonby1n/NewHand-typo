# NewHand-typo 🤟

카메라로 손을 인식해서, 손가락 끝에 올려둔 단어를 엄지로 튕기면 목소리로 말해주는 인터랙티브 웹앱입니다.
양손을 동시에 인식하고, 손가락마다 다른 단어와 파스텔 색상을 지정할 수 있어요.

## Demo

> 스크린샷 / GIF를 여기에 추가하세요.

## 기능

- 📷 **손 인식**: MediaPipe Hand Landmarker로 실시간 21개 손 랜드마크 추적, 손가락 끝(빨간 점)만 표시하고 나머지 스켈레톤은 숨김
- 🖐️ **양손 지원**: 왼손·오른손 각각 검지/중지/약지/소지에 서로 다른 단어를 설정 가능 (총 8개)
- 🤏 **핀치 제스처**: 엄지와 손가락 끝을 튕기면(pinch) 해당 단어를 음성으로 읽어줌
- 🎨 **손가락별 파스텔 컬러**: 민트(검지) · 레몬(중지) · 핑크(약지) · 라벤더(소지) 텍스트 색상, 배경 박스 없이 텍스트만 표시
- 🗣️ **음성 커스터마이즈**: 기기에 설치된 한국어 음성 목록 중 선택 가능
- 📱 **가로 모드 안내**: 세로로 들고 있으면 회전 안내 오버레이 표시
- ⚠️ **인앱 브라우저 감지**: 인스타그램/카카오톡 등 인앱 브라우저에서는 카메라 접근이 막히므로, 기본 브라우저로 열도록 안내 + 링크 복사 버튼 제공

## 기술 스택

- Vanilla HTML / CSS / JavaScript (프레임워크 없음)
- [MediaPipe Tasks Vision (Hand Landmarker)](https://developers.google.com/mediapipe/solutions/vision/hand_landmarker) — CDN으로 로드
- Web Speech API (`SpeechSynthesis`) — 텍스트 음성 변환

빌드 도구나 의존성 설치가 필요 없는 정적 사이트입니다.

## 로컬에서 실행하기

카메라(`getUserMedia`)는 보안 컨텍스트(HTTPS 또는 `localhost`)에서만 동작하므로, `index.html`을 파일로 직접 열면 안 되고 로컬 서버로 띄워야 합니다.

```bash
# Python
python3 -m http.server 8080

# 또는 Node
npx serve .
```

이후 브라우저에서 `http://localhost:8080` 접속.

VS Code를 쓴다면 **Live Server** 확장을 설치하고 `index.html`을 우클릭 → *Open with Live Server*로도 실행할 수 있습니다.

## 모바일에서 테스트하기

실제 휴대폰 카메라로 테스트하려면 `localhost`가 아닌 HTTPS 주소가 필요합니다. Vercel, Netlify, GitHub Pages 등 정적 호스팅에 그대로 배포하면 자동으로 HTTPS가 적용됩니다.

```bash
# 예: Vercel
npx vercel --prod
```

배포 후에는 반드시 **기기 기본 브라우저**(Safari, Chrome 등)로 열어야 합니다. 인스타그램 DM, 카카오톡 등 인앱 브라우저에서는 카메라 권한이 막혀 있어 동작하지 않습니다.

## 프로젝트 구조

```
.
├── index.html   # 설정 화면 + 카메라 화면 마크업
├── style.css    # 스타일 (파스텔 라벨, 가로모드 오버레이 등)
├── app.js       # 손 인식, 핀치 감지, 음성 재생 로직
└── README.md
```

## 참고 / 저작권

- 손가락에 단어를 올려 발음하는 인터랙션은 Frompudding의 [HandTypo](https://prompudding.com/handtypo/)에서 영감을 받았습니다.
- 이 프로젝트는 특정 그룹·소속사와 관련이 없는 개인 팬메이드 프로젝트이며, 어떠한 공식 계정과도 무관합니다.
