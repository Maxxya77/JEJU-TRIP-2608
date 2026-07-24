import { supabase } from './supabaseClient.js';

const presenceLastSeen = { seunghyun: null, soyoung: null };
const ONLINE_THRESHOLD_MS = 90 * 1000; // 90초 이내 신호면 온라인으로 간주

function relativeTime(ts) {
  if (!ts) return '-';
  const diffMs = Date.now() - ts;
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  return `${day}일 전`;
}

function formatPresence(name, ts) {
  if (ts && (Date.now() - ts) <= ONLINE_THRESHOLD_MS) return `🟢 ${name} 온라인`;
  return `${name} ${relativeTime(ts)}`;
}

function renderPresence() {
  const shEl = document.getElementById('presence-seunghyun');
  const syEl = document.getElementById('presence-soyoung');
  if (shEl) shEl.textContent = formatPresence('승현', presenceLastSeen.seunghyun);
  if (syEl) syEl.textContent = formatPresence('소영', presenceLastSeen.soyoung);
}

async function markPresence(who) {
  await supabase.from('presence').upsert({ who, last_seen: Date.now() });
}

function startPresence(who) {
  markPresence(who);
  setInterval(() => markPresence(who), 60000); // 페이지 열려있는 동안 1분마다 갱신
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') markPresence(who);
  });
}

export async function initPresence() {
  const { data, error } = await supabase.from('presence').select('*');
  if (!error) {
    data.forEach((row) => {
      if (presenceLastSeen.hasOwnProperty(row.who)) presenceLastSeen[row.who] = row.last_seen;
    });
    renderPresence();
  }

  supabase
    .channel('presence-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'presence' }, (payload) => {
      const row = payload.new;
      if (row && presenceLastSeen.hasOwnProperty(row.who)) {
        presenceLastSeen[row.who] = row.last_seen;
        renderPresence();
      }
    })
    .subscribe();

  setInterval(renderPresence, 30000); // 시간 표시 자동 갱신 (30초마다)

  const myIdentity = localStorage.getItem('tripIdentity');
  if (myIdentity) {
    startPresence(myIdentity);
  } else {
    document.getElementById('identity-modal').classList.add('show');
  }

  document.querySelectorAll('.identity-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const who = btn.dataset.who;
      localStorage.setItem('tripIdentity', who);
      document.getElementById('identity-modal').classList.remove('show');
      startPresence(who);
    });
  });
}
