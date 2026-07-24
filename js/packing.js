import { supabase } from './supabaseClient.js';

let items = [];

function render() {
  const packListEl = document.getElementById('packing-list-ul');
  if (!packListEl) return;
  packListEl.innerHTML = '';
  items.forEach((data) => {
    const id = data.id;
    const li = document.createElement('li');
    li.className = 'packing-item ' + ((data.seunghyun && data.soyoung) ? 'done' : '');
    li.innerHTML = `
      <span class="packing-text">${data.text}</span>
      <div class="user-checks">
        <label class="user-check-label"><input type="checkbox" id="sh-${id}" ${data.seunghyun ? 'checked' : ''}> 승현</label>
        <label class="user-check-label soyoung"><input type="checkbox" id="sy-${id}" ${data.soyoung ? 'checked' : ''}> 소영</label>
        <button class="packing-delete">✕</button>
      </div>
    `;
    li.querySelector(`#sh-${id}`).addEventListener('change', (e) => updateChecked(id, 'seunghyun', e.target.checked));
    li.querySelector(`#sy-${id}`).addEventListener('change', (e) => updateChecked(id, 'soyoung', e.target.checked));
    li.querySelector('.packing-delete').addEventListener('click', () => {
      if (!confirm(`"${data.text}"을(를) 목록에서 삭제할까요?`)) return;
      supabase.from('packing_items').delete().eq('id', id);
    });
    packListEl.appendChild(li);
  });
}

async function updateChecked(id, who, checked) {
  await supabase.from('packing_items').update({ [who]: checked }).eq('id', id);
}

async function addPackingItem() {
  const inputEl = document.getElementById('packing-input');
  if (!inputEl.value.trim()) return;
  await supabase.from('packing_items').insert({ text: inputEl.value.trim(), sort_order: Date.now() });
  inputEl.value = '';
}

export async function initPacking() {
  const { data, error } = await supabase.from('packing_items').select('*').order('sort_order', { ascending: true });
  if (error) { console.error(error); return; }
  items = data;
  render();

  supabase
    .channel('packing-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'packing_items' }, (payload) => {
      if (payload.eventType === 'DELETE') {
        items = items.filter((i) => i.id !== payload.old.id);
      } else {
        const idx = items.findIndex((i) => i.id === payload.new.id);
        if (idx === -1) items.push(payload.new);
        else items[idx] = payload.new;
        items.sort((a, b) => a.sort_order - b.sort_order);
      }
      render();
    })
    .subscribe();

  document.getElementById('btn-add-packing').addEventListener('click', addPackingItem);
  document.getElementById('packing-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addPackingItem();
  });
}
