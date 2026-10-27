# HS & YE 설치 가이드

HS와 예은이 둘만 쓰는 데이트 앱이에요. 카카오 지도로 가고 싶은 곳을 찍어 두고, 동선을 짜고, 추억을 사진과 함께 남길 수 있어요.

모든 서비스는 **무료 요금제 안에서** 쓸 수 있어요. 전체 과정은 30분 정도 걸려요.

| 역할 | 서비스 | 하는 일 |
|---|---|---|
| 앱 주소 | GitHub Pages | 앱 파일을 올려 두고 `https://아이디.github.io/hs-ye/` 주소를 만들어요 |
| 저장소 | Supabase | 로그인, 장소·플랜·추억 데이터, 사진을 보관해요 |
| 지도 | 카카오맵 API | 지도, 가게 검색, 주소 찾기를 해요 |

순서가 중요해요. **GitHub 주소가 먼저 있어야** 카카오와 Supabase에 그 주소를 등록할 수 있어요.

---

## 1단계. GitHub에 앱 올리기 (약 5분)

1. [github.com](https://github.com)에 가입하거나 로그인해요.
2. 오른쪽 위 **＋ → New repository**를 눌러요.
   - Repository name: `hs-ye`
   - **Public** 선택 (무료 계정에서 Pages를 쓰려면 공개여야 해요. 코드만 공개되고, 우리 데이터와 사진은 Supabase에 잠겨 있어서 보이지 않아요.)
   - **Create repository**
3. 새 저장소 화면에서 **uploading an existing file** 링크를 눌러요.
4. 압축을 푼 `hs-ye` 폴더 **안의 파일과 폴더 전부**를 끌어다 놓고 **Commit changes**를 눌러요.
   (`index.html`이 저장소 맨 위에 보여야 해요.)
5. 저장소의 **Settings → Pages**로 가서
   - Source: **Deploy from a branch**
   - Branch: **main**, 폴더 **/ (root)** → **Save**
6. 1~2분 뒤 같은 화면 위쪽에 주소가 떠요: `https://아이디.github.io/hs-ye/`
   이 주소를 메모해 두세요. 아래에서 계속 써요.

## 2단계. Supabase 만들기 (약 10분)

1. [supabase.com](https://supabase.com)에서 **Start your project → Continue with GitHub**로 로그인해요.
2. **New project**
   - Name: `hs-ye`
   - Database Password: 아무거나 길게 (따로 쓸 일은 거의 없어요)
   - Region: **Northeast Asia (Seoul)**
   - **Create new project** 후 1~2분 기다려요.
3. 왼쪽 메뉴 **SQL Editor → New query**
   - 이 폴더의 `supabase/schema.sql` 내용을 전부 복사해서 붙여넣어요.
   - **맨 위의 이메일 두 개를 HS와 예은이의 실제 이메일(소문자)로 바꿔요.**
   - **Run**을 눌러 `Success`가 나오면 끝이에요.
4. 왼쪽 **Authentication → URL Configuration**
   - Site URL: `https://아이디.github.io/hs-ye/`
   - Redirect URLs에도 같은 주소를 **Add URL**로 추가해요.
   (가입 확인 메일의 링크가 우리 앱으로 돌아오게 하는 설정이에요.)
5. 왼쪽 아래 **Project Settings → API** (또는 **Data API / API Keys**)에서 두 가지를 복사해 둬요.
   - **Project URL** (`https://xxxx.supabase.co`)
   - **anon public** 키 (긴 문자열)

> 무료 프로젝트는 **일주일 동안 아무도 안 쓰면 잠들어요.** 그러면 Supabase 대시보드에 들어가서 **Restore**를 누르면 다시 켜져요. 데이터는 지워지지 않아요.

## 3단계. 카카오맵 키 받기 (약 5분)

1. [developers.kakao.com](https://developers.kakao.com)에 카카오 계정으로 로그인하고, 처음이면 개발자 등록을 해요.
2. **내 애플리케이션 → 애플리케이션 추가하기**
   - 앱 이름: `HS & YE`, 회사명: 본인 이름 → 저장
3. 만든 앱에 들어가서 **앱 키**에 있는 **JavaScript 키**를 복사해 둬요. (REST API 키 말고 JavaScript 키예요.)
4. **제품 설정 → 카카오맵 → 사용 설정**에서 상태를 **ON**으로 켜요.
   - 계정에서 처음 켠 앱이라면 별도 심사나 결제 연결 없이 무료로 쓸 수 있어요.
5. 도메인 등록: **JavaScript 키 설정의 JavaScript SDK 도메인**(또는 **앱 설정 → 플랫폼 → Web 사이트 도메인**)에
   `https://아이디.github.io` 를 추가하고 저장해요.
   - 끝에 `/hs-ye/` 는 붙이지 않아요. `https://`부터 `.io`까지만 적어요.

## 4단계. config.js 채우기 (약 3분)

GitHub 저장소에서 `config.js`를 눌러 오른쪽 위 **연필(✏️) 아이콘**으로 편집해요.

```js
window.HSYE_CONFIG = {
  kakaoJsKey: "3단계에서 복사한 JavaScript 키",
  supabaseUrl: "https://xxxx.supabase.co",
  supabaseAnonKey: "2단계에서 복사한 anon public 키",
  members: {
    "hs의이메일@gmail.com": "HS",
    "예은이의이메일@gmail.com": "YE"
  }
};
```

- `members` 이메일은 `schema.sql`에 적은 것과 **똑같이** 적어요.
- **Commit changes**를 누르면 1분쯤 뒤 사이트에 반영돼요.

## 5단계. 각자 휴대폰에서 시작하기

1. 휴대폰에서 `https://아이디.github.io/hs-ye/` 를 열어요.
2. 이메일과 비밀번호를 적고 **처음이에요 · 계정 만들기**를 눌러요.
3. 메일함의 Supabase 확인 메일에서 링크를 눌러요. (스팸함도 확인해 주세요.)
4. 다시 앱에서 **로그인**해요.
5. 홈 화면에 설치해요.
   - **아이폰(Safari)**: 아래 공유 버튼 → **홈 화면에 추가**
   - **갤럭시(Chrome·삼성 인터넷)**: 메뉴 ⋮ → **홈 화면에 추가** 또는 **앱 설치**

예은이도 같은 방법으로 자기 이메일로 가입하면, 둘이 같은 장소·플랜·추억을 실시간으로 함께 보게 돼요.

---

## 잘 안 될 때

| 증상 | 확인할 것 |
|---|---|
| "설정이 아직 안 끝났어요" | `config.js`의 키 세 개가 비어 있지 않은지 |
| "카카오 지도를 불러오지 못했어요" | ① 카카오맵 사용 설정 ON ② 도메인이 `https://아이디.github.io` 로 정확히 등록됐는지 ③ JavaScript 키가 맞는지 (REST 키 아님) |
| "config.js에 등록된 이메일만 가입할 수 있어요" | `members`에 그 이메일이 소문자로 들어 있는지 |
| "데이터를 불러오지 못했어요" | `schema.sql`을 실행했는지, 거기 적은 이메일이 로그인 이메일과 같은지 |
| 확인 메일 링크가 이상한 주소로 감 | Supabase **Authentication → URL Configuration**의 Site URL |
| 한동안 안 쓰다가 안 열림 | Supabase 대시보드에서 프로젝트 **Restore** |
| 수정한 게 폰에 안 보임 | 앱을 완전히 껐다 다시 열기 (새 버전을 받아요) |

## 파일 구성

```
index.html            앱 화면 뼈대
styles.css            디자인
app.js                기능 전부 (지도, 플랜, 추억, 로그인, 저장)
config.js             ← 키를 채우는 파일
manifest.webmanifest  홈 화면 설치 정보
sw.js                 앱을 빠르게 열어 주는 캐시
icons/                앱 아이콘
supabase/schema.sql   ← Supabase에서 한 번 실행하는 설정
```
