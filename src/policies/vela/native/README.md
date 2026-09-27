# VELA-v4.1 WASM 빌드

이 폴더에는 VELA-v4.1의 C++ 원본과 환경 테이블이 있습니다. 빌드에는 Python 3와 **Emscripten 4.0.23**이 필요합니다. 아래 명령은 프로젝트 루트에서 실행합니다.

## 도구 준비

Git과 `python` 명령을 사용할 수 있는 환경에서 SDK를 처음 설치할 때:

```powershell
git clone https://github.com/emscripten-core/emsdk.git .tools/emsdk-main
python .tools/emsdk-main/emsdk.py install 4.0.23
python .tools/emsdk-main/emsdk.py activate 4.0.23
```

이미 해당 버전의 SDK가 준비되어 있으면 이 단계는 생략합니다.

## 빌드

```powershell
python scripts/vela/build.py
```

다음 파일을 생성하거나 갱신합니다.

- `src/policies/vela/vela.mjs`: JS 로더
- `src/policies/vela/vela.wasm`: WASM 실행 파일
- `public/models/vela-v4.1/manifest.json`: 실행 파일 크기와 SHA-256 등 메타데이터

manifest의 크기·해시를 갱신하므로 `public/models/vela-v4.1/model.bin.gz`가 필요합니다. 이 파일은 COMPACT48 모델 바이너리를 gzip으로 압축한 파일입니다. 배포 시 실행 파일 두 개와 manifest, 모델을 같은 버전으로 맞춥니다.

## 소스 구성

- `bridge.cpp`: 브라우저에서 호출하는 함수와 입출력
- `core.hpp`: 상태와 손패 클래스 인코딩
- `compact.hpp`: COMPACT48 모델 읽기와 가치 계산
- `inference.hpp`: 2-step expectimax 행동 평가
- `tables.hpp`: 환경 전이 테이블
- `deck-coefficients.hpp`: 잔여 덱 보정 계수

빌드 스크립트는 `scripts/vela/build.py`, manifest 갱신 코드는 `scripts/vela/delivery.py`에 있습니다.

COMPACT48의 가치값을 그대로 사용하며, 실제 잔여 덱과 DeckPotential β=0.6을 반영합니다. 입력 손패는 물리 카드 ID 1~30, 반환 행동은 0(주사위) 또는 1~5(손패 슬롯)입니다.
