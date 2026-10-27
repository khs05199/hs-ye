// HS & YE 설정 파일 — 아래 네 가지만 채우면 돼요. (README.md 단계 참고)
// 이 값들은 공개돼도 괜찮은 '공개용 키'예요. 카카오 키는 등록한 도메인에서만,
// Supabase 키는 아래 두 이메일로 로그인한 사람만 데이터를 볼 수 있게 막혀 있어요.
window.HSYE_CONFIG = {
  // 1) 카카오디벨로퍼스 > 내 애플리케이션 > 앱 키 > JavaScript 키
  kakaoJsKey: "",

  // 2) Supabase > Project Settings > API 의 Project URL
  supabaseUrl: "",

  // 3) Supabase > Project Settings > API 의 anon public 키
  supabaseAnonKey: "",

  // 4) 두 사람이 로그인할 이메일 (소문자로). schema.sql 에 적은 이메일과 같아야 해요.
  members: {
    "khs05199@gmail.com": "HS",
    "예은이이메일@example.com": "YE"
  }
};
