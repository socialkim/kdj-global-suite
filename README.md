# KDJ Global Suite — 김덕진 글로벌 프로젝트

> 🤖 Made with **Claude Fable 5** (Anthropic) · Built end-to-end by Claude Code with a 200+ AI-agent workflow

김덕진 소장(IT커뮤니케이션연구소)의 유튜브 방송 플레이리스트(91편, 2024.01–2026.07)를 기반으로 한 두 가지 서비스입니다.

| 프로젝트 | 바로가기 |
|----------|----------|
| 📜 **김덕진 답변 연대기 V3** — 질문을 검색하면 과거→현재 답변 변화를 보여주는 검색형 서비스 | **[라이브 페이지](https://socialkim.github.io/kdj-global-suite/)** |
| 📜 연대기 V2 (검색형 초기 버전) / V1 (클래식 아카이브) | [v2.html](https://socialkim.github.io/kdj-global-suite/v2.html) · [v1.html](https://socialkim.github.io/kdj-global-suite/v1.html) |
| 🌏 **Global 김덕진** — 한국어 방송에 영어 자막·AI 요약을 입히는 크롬 확장 | **[다운로드 (zip)](https://github.com/socialkim/kdj-global-suite/releases/latest)** |

> V2부터는 화자 분류를 거쳐 **김덕진 소장 본인 방송(69편)만** 수록합니다. V3는 경쟁 구현(ChatGPT 제작 버전)을 실측 리뷰한 뒤 장점 — 카테고리 필터, 변화 크기 배지, 답변 지형도 매트릭스, Δ 직전 답변과 달라진 점, 썸네일 근거 카드, 버전 스위처 — 을 흡수하고, 고유 강점(자막 원문 인용+타임스탬프 점프, 질문당 최대 26개 답변, 예측 채점표, 명언 아카이브, EN 토글)을 유지한 업그레이드입니다.

---

## 📜 김덕진 답변 연대기 (The Answer Chronicle)

매주 AI에 대한 질문에 답하다 보면 같은 질문인데도 답이 달라진다 — 기술이 변했기 때문이다.
2년 반치 방송 91편을 AI 에이전트 팀이 전수 분석해서 만든 기록.

- **반복 주제별 타임라인** — "AI는 버블인가?", "에이전트는 어디까지 왔나?" 같은 질문에 대한 답의 변화를 시간순으로 추적
- **그때는 → 지금은** — 각 주제의 첫 답변과 최신 답변 대비
- **변곡점 표시** — 입장이 실제로 바뀐 순간을 배지로 표시
- **🎯 예측 채점표** — 방송에서 했던 구체적 예측을 이후 사실로 채점 (적중/부분적중/빗나감/미확정)
- **💬 명언 아카이브** — 기술을 비유로 번역해 온 문장들
- 모든 항목에 **자막 원문 인용 + 해당 시각 유튜브 링크**, 한국어/영어 토글

소스: [`answer-chronicle/`](answer-chronicle/) · 정적 페이지 하나로 완결 (`index.html`)

## 🌏 Global 김덕진 (Chrome Extension)

Korean tech broadcasts, made accessible to global viewers.

- **영어 자막 오버레이** — 영상의 한국어 자막을 실시간 번역해 플레이어에 표시 (듀얼 KO+EN 모드 지원)
- **번역 엔진 3종** — Google 무료(키 불필요) / Claude API / OpenAI API
- **AI 영어 요약 패널** — 플레이리스트 91편은 큐레이션 요약 내장(키 불필요), 그 외 영상은 API 키로 실시간 생성
- 번역 캐시(최근 30개 영상), Manifest V3

### 설치 (테스트 방법)

1. [Releases](https://github.com/socialkim/kdj-global-suite/releases/latest)에서 `global-kdj-extension.zip` 다운로드 후 압축 해제 (또는 이 저장소 clone)
2. Chrome에서 `chrome://extensions` 접속 → 우측 상단 **개발자 모드** ON
3. **압축해제된 확장 프로그램을 로드합니다** → `chrome-extension/` 폴더 선택
4. 유튜브에서 [김덕진 방송](https://www.youtube.com/playlist?list=PL-5ePmULnsmQidzPL5DTTh6YDInCYodV3)을 열면 자동 작동

소스: [`chrome-extension/`](chrome-extension/) · 상세 문서는 폴더 안 README 참조

---

## 어떻게 만들어졌나

1. `yt-dlp`로 플레이리스트 91편의 메타데이터 + 한국어 자막 수집
2. **Claude Fable 5 에이전트 워크플로우** (2차에 걸쳐 200개 이상):
   - 영상별 분석 에이전트 91개 병렬 — 주제·Q&A·입장·인용·영어 요약 추출
   - 클러스터링 → 주제별 연대기 → 심화(배경·맥락 보강) → 신규 주제 발굴
   - 예측 발굴 3개 + 판정 에이전트, 명언 수집 에이전트
   - 조립 + 검증 에이전트 (JSON 무결성·인용 대조·번역 품질)
3. `answer-chronicle/build_page.py`가 데이터를 템플릿에 주입해 정적 페이지 생성

> ⚠️ 인용문은 유튜브 자동 생성 자막 기반이라 원문과 미세한 차이가 있을 수 있고,
> 예측 채점은 AI의 판정이므로 참고용입니다.

## License

MIT — 자유롭게 사용하되, 방송 콘텐츠의 저작권은 김덕진 / IT커뮤니케이션연구소에 있습니다.
