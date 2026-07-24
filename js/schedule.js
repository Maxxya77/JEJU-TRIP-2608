import { supabase } from './supabaseClient.js';
import { getPlace, onPlacesChange } from './places.js';
import { CAT_PALETTE, DEFAULT_PALETTE } from './palette.js';

const DAYS = ['d1', 'd2', 'd3', 'd4'];
let rawRows = [];
const scheduleByDay = { d1: [], d2: [], d3: [], d4: [] };
const listeners = [];

function notify(event) {
  listeners.forEach((cb) => cb(event));
}

export function onScheduleChange(cb) {
  listeners.push(cb);
}

export function getScheduleForDay(day) {
  return scheduleByDay[day] || [];
}

function mapRow(row) {
  return { id: row.id, day: row.day, placeId: row.place_id, time: row.time, memo: row.memo || '', order: row.sort_order };
}

function rebuild() {
  const temp = { d1: [], d2: [], d3: [], d4: [] };
  rawRows.forEach((row) => {
    const place = getPlace(row.placeId);
    if (temp[row.day] && place) {
      temp[row.day].push({ ...row, place });
    }
  });
  DAYS.forEach((day) => temp[day].sort((a, b) => a.order - b.order));
  Object.assign(scheduleByDay, temp);
  renderScheduleUI();
  notify({ type: 'update' });
}

export async function addToSchedule(day, placeId, opts = {}) {
  const { error } = await supabase.from('schedule').insert({
    day, place_id: placeId, time: opts.time || '', memo: opts.memo || '', sort_order: Date.now()
  });
  if (error) { window.showToast('일정 추가에 실패했어요'); return false; }
  return true;
}

export async function deleteItem(id, placeName) {
  if (!confirm(`"${placeName}"을(를) 일정에서 삭제할까요?`)) return;
  await supabase.from('schedule').delete().eq('id', id);
}

export async function updateTime(id, newTime) {
  await supabase.from('schedule').update({ time: newTime }).eq('id', id);
}

export async function updateMemo(id, newMemo) {
  await supabase.from('schedule').update({ memo: newMemo }).eq('id', id);
}

export async function moveItem(day, index, direction) {
  const list = scheduleByDay[day];
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= list.length) return;
  const currentOrder = list[index].order;
  const targetOrder = list[targetIndex].order;
  await supabase.from('schedule').update({ sort_order: targetOrder }).eq('id', list[index].id);
  await supabase.from('schedule').update({ sort_order: currentOrder }).eq('id', list[targetIndex].id);
}

function renderScheduleUI() {
  DAYS.forEach((day) => {
    const container = document.getElementById(`timeline-${day}`);
    if (!container) return;

    const list = scheduleByDay[day];
    if (list.length === 0) {
      container.innerHTML = `<div style="color:#888; font-size:13.5px; padding-bottom:10px;">일정이 비어있습니다. 장소 탐색 탭에서 스위치를 켜고 지도 핀을 눌러 추가해주세요.</div>`;
      return;
    }

    let htmlString = '';
    list.forEach((item, index) => {
      const upDisabled = index === 0 ? 'disabled style="opacity:0.3"' : '';
      const downDisabled = index === list.length - 1 ? 'disabled style="opacity:0.3"' : '';
      const pal = CAT_PALETTE[item.place.category] || DEFAULT_PALETTE;

      htmlString += `
        <div class="stop">
          <div class="stop-header">
            <div class="time-box">
              <input type="text" class="time-input" placeholder="시간 입력" value="${item.time || ''}"
                     onblur="window.updateTime('${item.id}', this.value)"
                     onkeydown="if(event.key==='Enter') this.blur();">
            </div>
            <div class="stop-controls">
              <button class="btn-ctrl" onclick="window.moveItem('${day}', ${index}, -1)" ${upDisabled}>▲</button>
              <button class="btn-ctrl" onclick="window.moveItem('${day}', ${index}, 1)" ${downDisabled}>▼</button>
              <button class="btn-ctrl del" onclick="window.deleteItem('${item.id}', '${item.place.name.replace(/'/g, "\\'")}')">✕</button>
            </div>
          </div>
          <div class="name-wrap">
            <span class="name">${item.place.name}</span>
            <span class="category" style="background:${pal.bg}; color:${pal.text};">${item.place.category}</span>
          </div>
          <div class="note">${item.place.desc || ''}</div>
          <a href="javascript:void(0)" onclick="window.openKakaoDetailByName('${window.escJs(item.place.name)}', ${item.place.lat}, ${item.place.lng})" class="kakao-link">🗺️ 카카오맵</a>
          <a href="javascript:void(0)" onclick="window.kakaoNaviStart('${window.escJs(item.place.name)}', ${item.place.lat}, ${item.place.lng})" class="nav-link">🧭 길찾기 (모바일 전용)</a>
          <input type="text" class="stop-memo-input" placeholder="💬 메모 남기기 (승현/소영 둘 다 보여요)" value="${(item.memo || '').replace(/"/g, '&quot;')}"
                 onblur="window.updateMemo('${item.id}', this.value)"
                 onkeydown="if(event.key==='Enter') this.blur();">
        </div>
      `;
    });
    container.innerHTML = htmlString;
  });
}

export async function initSchedule() {
  const { data, error } = await supabase.from('schedule').select('*').order('sort_order', { ascending: true });
  if (error) { console.error(error); return; }
  rawRows = data.map(mapRow);
  rebuild();

  supabase
    .channel('schedule-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'schedule' }, (payload) => {
      if (payload.eventType === 'DELETE') {
        rawRows = rawRows.filter((r) => r.id !== payload.old.id);
      } else {
        const mapped = mapRow(payload.new);
        const idx = rawRows.findIndex((r) => r.id === mapped.id);
        if (idx === -1) rawRows.push(mapped);
        else rawRows[idx] = mapped;
      }
      rebuild();
    })
    .subscribe();

  // 장소가 새로 생기거나(커스텀 저장) 숨김 상태가 바뀌면 일정 쪽 place 조인도 다시 계산해야 한다.
  onPlacesChange(() => rebuild());
}

window.deleteItem = deleteItem;
window.updateTime = updateTime;
window.updateMemo = updateMemo;
window.moveItem = moveItem;
