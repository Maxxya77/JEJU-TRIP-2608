import { supabase } from './supabaseClient.js';
import { CAT_PALETTE, DEFAULT_PALETTE } from './palette.js';

const placesById = {};
const activeExploreKeys = new Set();
const listeners = [];
let sortMode = 'name';

function notify(event) {
  listeners.forEach((cb) => cb(event));
}

// map.js가 구독해서 마커를 다시 그리거나(항상) 특정 장소로 카메라를 이동(type:'toggle' && checked)할지 판단한다.
export function onPlacesChange(cb) {
  listeners.push(cb);
}

export function getPlaces() {
  return placesById;
}

export function getPlace(id) {
  return placesById[id];
}

export function getActiveExploreKeys() {
  return activeExploreKeys;
}

function mapRow(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    lat: row.lat,
    lng: row.lng,
    desc: row.description,
    url: row.url,
    isHidden: row.is_hidden,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : 0
  };
}

function applyRow(row) {
  placesById[row.id] = mapRow(row);
}

// 체크박스가 이미 change 이벤트로 자기 상태를 바꾼 뒤라 리스트 전체를 다시 그릴 필요는 없다.
export function toggleExploreKey(key, checked) {
  if (checked) activeExploreKeys.add(key);
  else activeExploreKeys.delete(key);
  updateMasterToggle();
  notify({ type: 'toggle', key, checked });
}

// 검색창에서 "내 리스트에 있어요" 항목을 골랐을 때처럼, 체크박스 DOM이 아직 없는 경우 리스트를 새로 그려야 한다.
export function activateExploreKey(key) {
  activeExploreKeys.add(key);
  renderExploreList();
  notify({ type: 'toggle', key, checked: true });
}

export async function hidePlace(id, name) {
  if (!confirm(`"${name}"을(를) 리스트에서 숨길까요?\n지도/일정에서도 안 보이게 되고, 나중에 리스트 맨 아래에서 복원할 수 있어요.`)) return;
  const { error } = await supabase.from('places').update({ is_hidden: true }).eq('id', id);
  if (error) window.showToast('숨기기에 실패했어요');
}

export async function restorePlace(id) {
  const { error } = await supabase.from('places').update({ is_hidden: false }).eq('id', id);
  if (error) window.showToast('복원에 실패했어요');
}

export async function saveCustomPlace(data) {
  const { error } = await supabase.from('places').upsert({
    id: data.id,
    name: data.name,
    category: data.category,
    lat: data.lat,
    lng: data.lng,
    description: data.desc,
    is_hidden: false
  });
  if (error) window.showToast('저장에 실패했어요');
}

function updateMasterToggle() {
  const visibleToggles = Array.from(document.querySelectorAll('.toggle-map-btn'));
  const masterToggle = document.getElementById('toggle-all-explore');
  if (!masterToggle) return;
  if (visibleToggles.length === 0) { masterToggle.checked = false; return; }
  masterToggle.checked = visibleToggles.every((btn) => btn.checked);
}

function renderExploreList() {
  const wrapper = document.getElementById('explore-wrapper');
  if (!wrapper) return;
  wrapper.innerHTML = '';

  const activeCats = Array.from(document.querySelectorAll('#category-chips .chip.on')).map((c) => c.dataset.category);
  const searchEl = document.getElementById('explore-search');
  const searchQuery = (searchEl ? searchEl.value : '').trim().toLowerCase();

  let matchedKeys = Object.keys(placesById).filter((key) => {
    const place = placesById[key];
    if (place.isHidden) return false;
    if (!activeCats.includes('all') && !activeCats.includes(place.category)) return false;
    if (searchQuery && !(place.name.toLowerCase().includes(searchQuery) || (place.desc || '').toLowerCase().includes(searchQuery))) return false;
    return true;
  });

  if (sortMode === 'name') {
    matchedKeys.sort((a, b) => placesById[a].name.localeCompare(placesById[b].name, 'ko'));
  } else {
    matchedKeys.sort((a, b) => (placesById[b].createdAt || 0) - (placesById[a].createdAt || 0));
  }

  matchedKeys.forEach((key) => {
    const place = placesById[key];
    const isChecked = activeExploreKeys.has(key) ? 'checked' : '';
    const pal = CAT_PALETTE[place.category] || DEFAULT_PALETTE;

    wrapper.innerHTML += `
      <div class="place-card">
        <div class="info">
          <div class="name-wrap">
            <span class="name">${place.name}</span>
            <span class="category" style="background:${pal.bg}; color:${pal.text};">${place.category}</span>
            <button class="card-delete-btn" onclick="window.hidePlace('${key}', '${place.name.replace(/'/g, "\\'")}')">✕</button>
          </div>
          <p class="desc">${place.desc || ''}</p>
          <a href="javascript:void(0)" onclick="window.openKakaoDetailByName('${window.escJs(place.name)}', ${place.lat}, ${place.lng})" class="kakao-link">🗺️ 카카오맵에서 보기</a>
          <a href="javascript:void(0)" onclick="window.kakaoNaviStart('${window.escJs(place.name)}', ${place.lat}, ${place.lng})" class="nav-link">🧭 길찾기 (모바일 전용)</a>
        </div>
        <label class="switch">
          <input type="checkbox" class="toggle-map-btn" data-key="${key}" ${isChecked}>
          <span class="slider"></span>
        </label>
      </div>
    `;
  });

  const hiddenKeys = Object.keys(placesById).filter((key) => placesById[key].isHidden);
  if (hiddenKeys.length > 0) {
    wrapper.innerHTML += `
      <div class="hidden-restore-wrap">
        <a href="#" class="hidden-toggle-link" id="hidden-toggle-link">숨긴 장소 ${hiddenKeys.length}개 보기 ↓</a>
        <div class="hidden-list" id="hidden-list" style="display:none;"></div>
      </div>
    `;
  }

  const hiddenToggleLink = document.getElementById('hidden-toggle-link');
  if (hiddenToggleLink) {
    hiddenToggleLink.addEventListener('click', (e) => {
      e.preventDefault();
      const listEl = document.getElementById('hidden-list');
      const isOpen = listEl.style.display !== 'none';
      if (isOpen) {
        listEl.style.display = 'none';
        hiddenToggleLink.textContent = `숨긴 장소 ${hiddenKeys.length}개 보기 ↓`;
      } else {
        listEl.innerHTML = hiddenKeys.map((k) => {
          const p = placesById[k];
          const nm = p ? p.name : k;
          return `<div class="hidden-item"><span>${nm}</span><button class="restore-btn" data-key="${k}">복원</button></div>`;
        }).join('');
        listEl.style.display = 'block';
        hiddenToggleLink.textContent = '숨긴 장소 접기 ↑';
        listEl.querySelectorAll('.restore-btn').forEach((btn) => {
          btn.addEventListener('click', () => restorePlace(btn.dataset.key));
        });
      }
    });
  }

  wrapper.querySelectorAll('.toggle-map-btn').forEach((btn) => {
    btn.addEventListener('change', (e) => {
      toggleExploreKey(e.target.dataset.key, e.target.checked);
    });
  });
  updateMasterToggle();
}

function bindStaticListeners() {
  document.querySelectorAll('#category-chips .chip').forEach((chip) => {
    chip.addEventListener('click', (e) => {
      const cat = e.target.dataset.category;
      if (cat === 'all') {
        const isTurningOn = !e.target.classList.contains('on');
        document.querySelectorAll('#category-chips .chip').forEach((c) => c.classList.toggle('on', isTurningOn));
      } else {
        e.target.classList.toggle('on');
        const allCats = Array.from(document.querySelectorAll('#category-chips .chip')).filter((c) => c.dataset.category !== 'all');
        document.querySelector('#category-chips .chip[data-category="all"]').classList.toggle('on', allCats.every((c) => c.classList.contains('on')));
      }
      renderExploreList();
    });
  });

  document.getElementById('toggle-all-explore').addEventListener('change', (e) => {
    const isChecked = e.target.checked;
    document.querySelectorAll('.toggle-map-btn').forEach((btn) => {
      if (btn.checked !== isChecked) {
        btn.checked = isChecked;
        const key = btn.dataset.key;
        if (isChecked) activeExploreKeys.add(key);
        else activeExploreKeys.delete(key);
      }
    });
    notify({ type: 'bulk-toggle', checked: isChecked });
  });

  document.getElementById('explore-search').addEventListener('input', renderExploreList);

  document.querySelectorAll('.sort-link').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sort-link').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      sortMode = btn.dataset.sort;
      renderExploreList();
    });
  });
}

export async function initPlaces() {
  const { data, error } = await supabase.from('places').select('*').order('created_at', { ascending: true });
  if (error) { console.error(error); return; }
  data.forEach(applyRow);
  renderExploreList();
  notify({ type: 'init' }); // schedule.js/map.js가 초기 로드 완료 시점에도 반응할 수 있도록 알림

  supabase
    .channel('places-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'places' }, (payload) => {
      if (payload.eventType === 'DELETE') {
        delete placesById[payload.old.id];
        activeExploreKeys.delete(payload.old.id);
      } else {
        applyRow(payload.new);
        if (payload.new.is_hidden) activeExploreKeys.delete(payload.new.id);
      }
      renderExploreList();
      notify({ type: 'realtime' });
    })
    .subscribe();

  bindStaticListeners();
}

window.hidePlace = hidePlace;
window.restorePlace = restorePlace;
