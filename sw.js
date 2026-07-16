// 최소 서비스 워커 - 별도 캐싱 없이, 설치 가능(installable) 조건 충족용
self.addEventListener('install', (e) => {
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  // 캐싱 없이 그대로 네트워크로 전달
});
