import { CAT_PALETTE, DEFAULT_PALETTE } from './palette.js';
import {
  getPlace, getPlaces, getActiveExploreKeys,
  toggleExploreKey, activateExploreKey,
  restorePlace, saveCustomPlace, onPlacesChange
} from './places.js';
import { getScheduleForDay, addToSchedule, onScheduleChange } from './schedule.js';

const KAKAO_JS_KEY = '4955b7601b5308d5f68f0b45c264ca8f';
const DAY_COLORS = { d1: '#E37B34', d2: '#1C6E74', d3: '#2A6FA8', d4: '#5A7350' };
const MAX_CATEGORY_PAGES = 3; // 페이지당 최대 15개 x 3 = 최대 약 45개
const KEYWORD_MARKER_COLOR = '#C4611F';

let mainMap = null;
let placesService = null;

let dayLayers = {};
let exploreMarkers = {};
let exploreLabels = {};
let exploreInfoWindows = {};
let lastInfoWindow = null;
let searchResultMarker = null;
let pendingSearchResults = {};

let categoryMarkers = [];
let categoryMarkerEntries = [];
let hiddenNearbyLabels = [];
let activeCategoryCode = null;
let activeKeywordSearch = null;

// --- 카카오 SDK 공용 헬퍼 (다른 모듈의 onclick 문자열에서도 window.* 로 호출됨) ---
window.escJs = function (s) {
  return String(s).replace(/'/g, "\\'");
};
window.kakaoMapLink = function (name) {
  return `https://map.kakao.com/?q=${encodeURIComponent(name)}`;
};
window.kakaoNaviStart = function (name, lat, lng) {
  if (!window.Kakao || !window.Kakao.Navi) {
    window.showToast ? window.showToast('카카오내비 연결에 실패했어요') : alert('카카오내비 연결에 실패했어요');
    return;
  }
  window.Kakao.Navi.start({ name, x: lng, y: lat, coordType: 'wgs84' });
};

function makeDotImage(color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22"><circle cx="11" cy="11" r="8" fill="${color}" stroke="white" stroke-width="2.5"/></svg>`;
  const url = 'data:image/svg+xml;base64,' + btoa(svg);
  return new kakao.maps.MarkerImage(url, new kakao.maps.Size(22, 22), { offset: new kakao.maps.Point(11, 11) });
}

function makeSmallDotImage(color, size) {
  if (!size) size = (window.innerWidth <= 768) ? 30 : 18;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 2}" fill="${color}" stroke="white" stroke-width="2.5"/></svg>`;
  const url = 'data:image/svg+xml;base64,' + btoa(svg);
  return new kakao.maps.MarkerImage(url, new kakao.maps.Size(size, size), { offset: new kakao.maps.Point(size / 2, size / 2) });
}

function flyToPlace(lat, lng) {
  const pos = new kakao.maps.LatLng(lat, lng);
  const isMobile = window.innerWidth <= 768;
  const baseLevel = isMobile ? 10 : 9;
  const targetLevel = Math.min(mainMap.getLevel(), baseLevel);
  mainMap.setLevel(targetLevel, { animate: { duration: 400 } });
  mainMap.panTo(pos);
}

function clearSearchResultMarker() {
  if (searchResultMarker) {
    searchResultMarker.setMap(null);
    searchResultMarker = null;
  }
}

function restoreHiddenLabels() {
  hiddenNearbyLabels.forEach((label) => label.setMap(mainMap));
  hiddenNearbyLabels = [];
}

function hideLabelsNearPopup(lat, lng) {
  restoreHiddenLabels();
  const proj = mainMap.getProjection();
  const clickedPoint = proj.containerPointFromCoords(new kakao.maps.LatLng(lat, lng));
  const HALF_WIDTH = 110;
  const ABOVE = 220;
  const BELOW = 20;

  categoryMarkerEntries.forEach((entry) => {
    if (entry.lat === lat && entry.lng === lng) return;
    const pt = proj.containerPointFromCoords(new kakao.maps.LatLng(entry.lat, entry.lng));
    const dx = Math.abs(pt.x - clickedPoint.x);
    const dy = clickedPoint.y - pt.y;
    if (dx < HALF_WIDTH && dy > -BELOW && dy < ABOVE) {
      entry.label.setMap(null);
      hiddenNearbyLabels.push(entry.label);
    }
  });
}

function clearCategoryMarkers() {
  categoryMarkers.forEach((m) => m.setMap(null));
  categoryMarkers = [];
  categoryMarkerEntries = [];
  hiddenNearbyLabels = [];
}

function mapKakaoCategoryToBucket(kakaoPlace) {
  const code = kakaoPlace.category_group_code;
  const name = kakaoPlace.category_name || '';
  if (code === 'CE7') return '카페/디저트';
  if (code === 'AT4' || code === 'AD5') return '명소/여행지';
  if (/돈까스|돈가스|분식|우동|라멘|스시|초밥|일식/.test(name)) return '돈가스/분식';
  if (/고기|육류|흑돼지|소고기|삼겹살/.test(name)) return '고기 (흑돼지/소고기)';
  if (/해장국|국밥|찌개|탕/.test(name)) return '국/찌개 (해장국)';
  if (/해산물|수산|향토|횟집|물회|어시장/.test(name)) return '해산물/향토음식';
  if (code === 'FD6') return '양식/기타';
  return '명소/여행지';
}

// -----------------------------------------------------
// 지도 위 팝업 (일정 마커 / 탐색 마커 / 카카오 검색 결과 공용)
// -----------------------------------------------------
window.openStopLinks = function (name, lat, lng) {
  if (lastInfoWindow) lastInfoWindow.close();
  clearSearchResultMarker();
  const content = `
    <div class="popup-content" style="padding:10px; min-width:150px;">
      <h3 class="popup-title" style="margin-bottom:8px;">${name}</h3>
      <div class="link-row">
        <a href="javascript:void(0)" onclick="window.openKakaoDetailByName('${window.escJs(name)}', ${lat}, ${lng})" class="kakao-link">🗺️ 카카오맵</a>
        <a href="javascript:void(0)" onclick="window.kakaoNaviStart('${window.escJs(name)}', ${lat}, ${lng})" class="nav-link">🧭 길찾기 (모바일 전용)</a>
      </div>
    </div>
  `;
  const iw = new kakao.maps.InfoWindow({ position: new kakao.maps.LatLng(lat, lng), content, removable: true });
  iw.open(mainMap);
  lastInfoWindow = iw;
};

window.openKakaoDetailByName = function (name, lat, lng) {
  const fallback = window.kakaoMapLink(name);
  const newTab = window.open('', '_blank');
  placesService.keywordSearch(name, (data, status) => {
    const url = (status === kakao.maps.services.Status.OK && data.length > 0 && data[0].place_url) ? data[0].place_url : fallback;
    if (newTab) newTab.location.href = url;
    else window.open(url, '_blank');
  }, { location: new kakao.maps.LatLng(lat, lng), radius: 1000, size: 1 });
};

window.addFromPopup = async function (placeKey) {
  const sel = document.getElementById(`popup-sel-${placeKey}`);
  const day = sel ? sel.value : '';
  if (!day) return;
  const ok = await addToSchedule(day, placeKey);
  if (!ok) return;
  const place = getPlace(placeKey);
  window.showToast(`${place ? place.name : '장소'}이(가) 일정에 추가되었습니다!`);
  if (lastInfoWindow) lastInfoWindow.close();
  document.getElementById('btn-schedule').click();
};

window.showSearchResultPopup = function (d) {
  const lat = parseFloat(d.y), lng = parseFloat(d.x);
  const category = mapKakaoCategoryToBucket(d);
  const pal = CAT_PALETTE[category] || DEFAULT_PALETTE;
  const customKey = 'k_' + d.id;
  const kakaoDetailUrl = d.place_url || window.kakaoMapLink(d.place_name);

  if (lastInfoWindow) lastInfoWindow.close();
  flyToPlace(lat, lng);

  if (searchResultMarker) searchResultMarker.setMap(null);
  const marker = new kakao.maps.Marker({ position: new kakao.maps.LatLng(lat, lng), image: makeDotImage(pal.pin || pal.text) });
  marker.setMap(mainMap);
  searchResultMarker = marker;

  pendingSearchResults[customKey] = {
    id: customKey, name: d.place_name, lat, lng, category,
    desc: (d.category_name || '카카오맵 검색 결과')
  };

  const popupHtml = `
    <div class="popup-content">
      <div class="popup-title-row">
        <h3 class="popup-title">${d.place_name}</h3>
        <span class="popup-cat" style="background:${pal.bg}; color:${pal.text};">${category}</span>
      </div>
      <div class="popup-controls">
        <select id="popup-sel-${customKey}" class="popup-select">
          <option value="d1">1일 차</option>
          <option value="d2">2일 차</option>
          <option value="d3">3일 차</option>
          <option value="d4">4일 차</option>
        </select>
        <button class="popup-btn" onclick="window.addSearchResultToSchedule('${customKey}')">추가</button>
      </div>
      <button class="popup-save-btn" onclick="window.saveSearchResultToList('${customKey}')">⭐ 내 리스트에 저장</button>
      <a href="javascript:void(0)" onclick="window.kakaoNaviStart('${window.escJs(d.place_name)}', ${lat}, ${lng})" class="nav-link">🧭 길찾기 (모바일 전용)</a>
      ${d.place_url ? `<a href="${kakaoDetailUrl}" target="_blank" class="kakao-detail-link">🗺️ 카카오맵에서 사진·평점 보기</a>` : `<a href="${kakaoDetailUrl}" target="_blank" class="kakao-link">🗺️ 카카오맵에서 보기</a>`}
    </div>
  `;
  const iw = new kakao.maps.InfoWindow({ content: `<div style="padding:10px;">${popupHtml}</div>`, removable: true });
  iw.open(mainMap, marker);
  lastInfoWindow = iw;
};

window.saveSearchResultToList = async function (customKey) {
  const data = pendingSearchResults[customKey];
  if (!data) return;
  await saveCustomPlace(data);
  window.showToast(`${data.name}이(가) 내 리스트에 저장되었어요!`);
};

window.addSearchResultToSchedule = async function (customKey) {
  const data = pendingSearchResults[customKey];
  if (!data) return;
  const sel = document.getElementById(`popup-sel-${customKey}`);
  const day = sel ? sel.value : '';
  await saveCustomPlace(data); // 일정 참조를 위해 리스트에도 함께 저장
  await addToSchedule(day, customKey);
  window.showToast(`${data.name}이(가) 일정에 추가되었습니다!`);
  if (lastInfoWindow) lastInfoWindow.close();
  document.getElementById('btn-schedule').click();
};

function activateStarredPlace(key) {
  // clearSearchResultMarker/flyTo/팝업 열기는 onPlacesChange 구독(handlePlacesEvent)이 처리한다.
  activateExploreKey(key);
}

// -----------------------------------------------------
// 장소/일정 데이터 변경 → 지도 반영
// -----------------------------------------------------
function handlePlacesEvent(event) {
  if (event && event.type === 'toggle') clearSearchResultMarker();
  drawExploreMarkers();
  if (event && event.type === 'toggle' && event.checked) {
    const place = getPlace(event.key);
    if (place) {
      if (window.innerWidth <= 800) window.scrollTo({ top: 0, behavior: 'smooth' });
      flyToPlace(place.lat, place.lng);
      setTimeout(() => {
        const marker = exploreMarkers[event.key];
        const iw = exploreInfoWindows[event.key];
        if (marker && iw) {
          if (lastInfoWindow) lastInfoWindow.close();
          iw.open(mainMap, marker);
          lastInfoWindow = iw;
        }
      }, 450);
    }
  }
}

function drawScheduleLayers() {
  Object.keys(dayLayers).forEach((k) => {
    const layer = dayLayers[k];
    if (layer.polyline) layer.polyline.setMap(null);
    layer.overlays.forEach((o) => o.setMap(null));
  });
  dayLayers = {};

  ['d1', 'd2', 'd3', 'd4'].forEach((day) => {
    const chip = document.querySelector(`.m-chip[data-day="${day}"]`);
    if (!chip || !chip.classList.contains('on')) return;

    const places = getScheduleForDay(day);
    if (!places || places.length === 0) return;

    const latlngs = places.map((p) => new kakao.maps.LatLng(p.place.lat, p.place.lng));

    const base = getPlace('p_base');
    if (day !== 'd1' && base) {
      latlngs.unshift(new kakao.maps.LatLng(base.lat, base.lng));
    }

    const polyline = new kakao.maps.Polyline({
      path: latlngs,
      strokeWeight: 3,
      strokeColor: DAY_COLORS[day],
      strokeOpacity: 0.8,
      strokeStyle: 'shortdash'
    });
    polyline.setMap(mainMap);

    const overlays = places.map((p, i) => {
      const safeName = p.place.name.replace(/'/g, "\\'");
      const iconHtml = `
        <div style="position:relative; font-family:sans-serif; cursor:pointer;" onclick="window.openStopLinks('${safeName}', ${p.place.lat}, ${p.place.lng})">
          <div style="position:absolute; left:-14px; top:-14px; width:28px; height:28px; background:${DAY_COLORS[day]}; color:white; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:13px; border:2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3); z-index:2;">${i + 1}</div>
          <div style="position:absolute; left:16px; top:-12px; background:rgba(255,255,255,0.95); border:1.5px solid ${DAY_COLORS[day]}; color:#222; padding:3px 8px; border-radius:6px; font-size:12.5px; font-weight:700; white-space:nowrap; box-shadow: 0 1px 3px rgba(0,0,0,0.2); z-index:1;">${p.place.name}</div>
        </div>
      `;
      const overlay = new kakao.maps.CustomOverlay({
        position: new kakao.maps.LatLng(p.place.lat, p.place.lng),
        content: iconHtml,
        xAnchor: 0,
        yAnchor: 0,
        zIndex: 2
      });
      overlay.setMap(mainMap);
      return overlay;
    });

    dayLayers[day] = { polyline, overlays };
  });
}

function drawExploreMarkers() {
  if (lastInfoWindow) {
    lastInfoWindow.close();
    lastInfoWindow = null;
  }

  Object.values(exploreMarkers).forEach((m) => m.setMap(null));
  Object.values(exploreLabels).forEach((l) => l.setMap(null));
  exploreMarkers = {};
  exploreLabels = {};
  exploreInfoWindows = {};

  getActiveExploreKeys().forEach((key) => {
    const p = getPlace(key);
    if (!p) return;

    const pal = CAT_PALETTE[p.category] || DEFAULT_PALETTE;

    const marker = new kakao.maps.Marker({
      position: new kakao.maps.LatLng(p.lat, p.lng),
      image: makeDotImage(pal.pin || pal.text)
    });
    marker.setMap(mainMap);

    const labelOverlay = new kakao.maps.CustomOverlay({
      position: new kakao.maps.LatLng(p.lat, p.lng),
      content: `<div style="margin-top:15px; font-size:10.5px; font-weight:700; color:#3A352F; background:rgba(255,255,255,0.88); padding:1px 6px; border-radius:5px; white-space:nowrap; box-shadow:0 1px 3px rgba(0,0,0,0.15); pointer-events:none;">${p.name}</div>`,
      xAnchor: 0.5,
      yAnchor: 0,
      zIndex: 1
    });
    labelOverlay.setMap(mainMap);
    exploreLabels[key] = labelOverlay;

    const popupHtml = `
      <div class="popup-content">
        <div class="popup-title-row">
          <h3 class="popup-title">${p.name}</h3>
          <span class="popup-cat" style="background:${pal.bg}; color:${pal.text};">${p.category}</span>
        </div>
        <div class="popup-controls">
          <select id="popup-sel-${key}" class="popup-select">
            <option value="d1">1일 차</option>
            <option value="d2">2일 차</option>
            <option value="d3">3일 차</option>
            <option value="d4">4일 차</option>
          </select>
          <button class="popup-btn" onclick="window.addFromPopup('${key}')">추가</button>
        </div>
        <div class="link-row">
          <a href="javascript:void(0)" onclick="window.openKakaoDetailByName('${window.escJs(p.name)}', ${p.lat}, ${p.lng})" class="kakao-link">🗺️ 카카오맵</a>
          <a href="javascript:void(0)" onclick="window.kakaoNaviStart('${window.escJs(p.name)}', ${p.lat}, ${p.lng})" class="nav-link">🧭 길찾기 (모바일 전용)</a>
        </div>
      </div>
    `;
    const infowindow = new kakao.maps.InfoWindow({ content: `<div style="padding:10px;">${popupHtml}</div>`, removable: true });

    kakao.maps.event.addListener(marker, 'click', () => {
      if (lastInfoWindow) lastInfoWindow.close();
      clearSearchResultMarker();
      infowindow.open(mainMap, marker);
      lastInfoWindow = infowindow;
    });

    exploreMarkers[key] = marker;
    exploreInfoWindows[key] = infowindow;
  });
}

// -----------------------------------------------------
// 새 장소 검색 (카카오 로컬 검색 + 카테고리 빠른 검색)
// -----------------------------------------------------
function searchCategoryAllPages(code, color) {
  let allResults = [];
  let pageCount = 0;
  placesService.categorySearch(code, (data, status, pagination) => {
    if (status !== kakao.maps.services.Status.OK) return;
    allResults = allResults.concat(data);
    pageCount++;
    if (pagination && pagination.hasNextPage && pageCount < MAX_CATEGORY_PAGES) {
      pagination.nextPage();
    } else {
      renderCategoryMarkers(allResults, color);
    }
  }, { useMapBounds: true });
}

function searchKeywordAllPages(keyword) {
  let allResults = [];
  let pageCount = 0;
  placesService.keywordSearch(keyword, (data, status, pagination) => {
    if (status !== kakao.maps.services.Status.OK) return;
    allResults = allResults.concat(data);
    pageCount++;
    if (pagination && pagination.hasNextPage && pageCount < MAX_CATEGORY_PAGES) {
      pagination.nextPage();
    } else {
      renderCategoryMarkers(allResults, KEYWORD_MARKER_COLOR);
    }
  }, { bounds: mainMap.getBounds() });
}

function renderCategoryMarkers(data, color) {
  data.forEach((place) => {
    const lat = parseFloat(place.y), lng = parseFloat(place.x);
    const marker = new kakao.maps.Marker({ position: new kakao.maps.LatLng(lat, lng), image: makeSmallDotImage(color) });
    marker.setMap(mainMap);
    categoryMarkers.push(marker);

    const label = new kakao.maps.CustomOverlay({
      position: new kakao.maps.LatLng(lat, lng),
      content: `<div style="margin-top:12px; font-size:10px; font-weight:700; color:#3A352F; background:rgba(255,255,255,0.9); padding:1px 5px; border-radius:4px; white-space:nowrap; box-shadow:0 1px 2px rgba(0,0,0,0.15); pointer-events:none;">${place.place_name}</div>`,
      xAnchor: 0.5,
      yAnchor: 0,
      zIndex: 1
    });
    label.setMap(mainMap);
    categoryMarkers.push(label);
    categoryMarkerEntries.push({ lat, lng, label });

    kakao.maps.event.addListener(marker, 'click', () => {
      hideLabelsNearPopup(lat, lng);
      window.showSearchResultPopup(place);
    });
  });
}

function bindCategoryChips() {
  document.querySelectorAll('.cat-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const code = chip.dataset.code;
      const color = chip.dataset.color;

      if (activeCategoryCode === code) {
        chip.classList.remove('on');
        chip.style.background = '';
        chip.style.borderColor = '';
        activeCategoryCode = null;
        clearCategoryMarkers();
        return;
      }

      document.querySelectorAll('.cat-chip').forEach((c) => {
        c.classList.remove('on');
        c.style.background = '';
        c.style.borderColor = '';
      });
      chip.classList.add('on');
      chip.style.background = color;
      chip.style.borderColor = color;
      activeCategoryCode = code;
      activeKeywordSearch = null;
      clearCategoryMarkers();
      searchCategoryAllPages(code, color);
    });
  });
}

function bindMapSearchInput() {
  const mapSearchInput = document.getElementById('map-search-input');
  const mapSearchResults = document.getElementById('map-search-results');
  let searchDebounceTimer;

  function bindStarredClicks() {
    mapSearchResults.querySelectorAll('.map-search-result-item[data-star-key]').forEach((el) => {
      el.addEventListener('click', () => {
        activateStarredPlace(el.dataset.starKey);
        mapSearchResults.classList.remove('show');
        mapSearchInput.value = '';
      });
    });
    mapSearchResults.querySelectorAll('.map-search-result-item[data-restore-key]').forEach((el) => {
      el.addEventListener('click', () => {
        restorePlace(el.dataset.restoreKey);
        mapSearchResults.classList.remove('show');
        mapSearchInput.value = '';
      });
    });
  }

  mapSearchInput.addEventListener('input', () => {
    clearTimeout(searchDebounceTimer);
    const keyword = mapSearchInput.value.trim();
    if (!keyword) {
      mapSearchResults.classList.remove('show');
      mapSearchResults.innerHTML = '';
      if (activeKeywordSearch) {
        activeKeywordSearch = null;
        clearCategoryMarkers();
      }
      return;
    }

    const places = getPlaces();
    const kw = keyword.toLowerCase();
    const matchedKeys = Object.keys(places).filter((k) => k !== 'p_base' && places[k].name.toLowerCase().includes(kw));
    const visibleMatches = matchedKeys.filter((k) => !places[k].isHidden);
    const hiddenMatches = matchedKeys.filter((k) => places[k].isHidden);

    const starredHtml = visibleMatches.length ? `
      <div class="search-group-label">⭐ 내 리스트에 있어요</div>
      ${visibleMatches.map((k) => `
        <div class="map-search-result-item starred" data-star-key="${k}">
          <div class="r-name">⭐ ${places[k].name}</div>
          <div class="r-addr">${places[k].category}</div>
        </div>
      `).join('')}
    ` : '';

    const hiddenHtml = hiddenMatches.length ? `
      <div class="search-group-label">🙈 숨긴 장소예요 (눌러서 복원)</div>
      ${hiddenMatches.map((k) => `
        <div class="map-search-result-item hidden-match" data-restore-key="${k}">
          <div class="r-name">🙈 ${places[k].name}</div>
          <div class="r-addr">${places[k].category} · 눌러서 복원하기</div>
        </div>
      `).join('')}
    ` : '';

    mapSearchResults.innerHTML = starredHtml + hiddenHtml + `<div id="kakao-search-group"><div class="map-search-result-item" style="color:#999;">검색 중...</div></div>`;
    mapSearchResults.classList.add('show');
    bindStarredClicks();

    searchDebounceTimer = setTimeout(() => {
      placesService.keywordSearch(keyword, (data, status) => {
        const kakaoGroup = document.getElementById('kakao-search-group');
        if (!kakaoGroup) return;
        if (status !== kakao.maps.services.Status.OK || data.length === 0) {
          kakaoGroup.innerHTML = `<div class="map-search-result-item" style="color:#999;">카카오맵 검색 결과가 없어요</div>`;
          return;
        }
        const top = data.slice(0, 8);
        kakaoGroup.innerHTML = `
          <div class="search-group-label">🔍 카카오맵 검색 결과</div>
          ${top.map((d, i) => `
            <div class="map-search-result-item" data-idx="${i}">
              <div class="r-name">${d.place_name}</div>
              <div class="r-addr">${d.road_address_name || d.address_name}</div>
            </div>
          `).join('')}
        `;
        kakaoGroup.querySelectorAll('.map-search-result-item[data-idx]').forEach((el) => {
          el.addEventListener('click', () => {
            const idx = el.dataset.idx;
            window.showSearchResultPopup(top[idx]);
            mapSearchResults.classList.remove('show');
            mapSearchInput.value = '';
          });
        });
      }, { size: 8 });
    }, 350);
  });

  mapSearchInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const keyword = mapSearchInput.value.trim();
    if (!keyword) return;

    mapSearchResults.classList.remove('show');
    mapSearchInput.blur();

    document.querySelectorAll('.cat-chip').forEach((c) => {
      c.classList.remove('on');
      c.style.background = '';
      c.style.borderColor = '';
    });
    activeCategoryCode = null;
    activeKeywordSearch = keyword;

    clearCategoryMarkers();
    searchKeywordAllPages(keyword);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.map-search-wrap')) {
      mapSearchResults.classList.remove('show');
    }
  });
}

function bindScheduleChips() {
  const mapChips = document.querySelectorAll('.m-chip.schedule-chip');
  mapChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      const dayKey = chip.dataset.day;
      if (dayKey === 'all') {
        const isTurningOn = !chip.classList.contains('on');
        mapChips.forEach((c) => c.classList.toggle('on', isTurningOn));
      } else {
        chip.classList.toggle('on');
        const nowOn = chip.classList.contains('on');
        const allDayChips = Array.from(mapChips).filter((c) => c.dataset.day !== 'all');
        document.querySelector('.m-chip[data-day="all"]').classList.toggle('on', allDayChips.every((c) => c.classList.contains('on')));

        if (nowOn) {
          const section = document.getElementById(`sec-${dayKey}`);
          if (section) {
            section.classList.remove('collapsed');
            section.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }
      }
      drawScheduleLayers();
    });
  });
}

export function initMap() {
  if (window.Kakao && !window.Kakao.isInitialized()) {
    window.Kakao.init(KAKAO_JS_KEY);
  }

  mainMap = new kakao.maps.Map(document.getElementById('jejumap'), {
    center: new kakao.maps.LatLng(33.36, 126.52),
    level: 10
  });
  mainMap.setZoomable(true);
  window.mainMap = mainMap; // index.html의 '지도 크게보기' 버튼이 relayout()을 호출하기 위해 필요

  placesService = new kakao.maps.services.Places(mainMap);

  kakao.maps.event.addListener(mainMap, 'click', () => {
    clearSearchResultMarker();
    if (lastInfoWindow) { lastInfoWindow.close(); lastInfoWindow = null; }
    restoreHiddenLabels();
  });

  kakao.maps.event.addListener(mainMap, 'idle', () => {
    if (activeKeywordSearch) {
      clearCategoryMarkers();
      searchKeywordAllPages(activeKeywordSearch);
      return;
    }
    if (!activeCategoryCode) return;
    const chip = document.querySelector(`.cat-chip[data-code="${activeCategoryCode}"]`);
    const color = chip ? chip.dataset.color : '#888';
    clearCategoryMarkers();
    searchCategoryAllPages(activeCategoryCode, color);
  });

  bindCategoryChips();
  bindMapSearchInput();
  bindScheduleChips();

  onPlacesChange(handlePlacesEvent);
  onScheduleChange(() => drawScheduleLayers());
}
