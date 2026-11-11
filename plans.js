/** Editor e bozza del piano. Richiede gli helper di app.js e post() di shopping.js. Il PDF è solo un allegato. */
'use strict';
let planDraft = null,
  planManagerLoaded = false,
  planCatalog = [],
  planUnits = [],
  planPdf = null,
  planPdfUrl = null,
  reviewedPayload = null;
const mealNames = ['colazione', 'spuntino', 'pranzo', 'merenda', 'cena'];
const weekdayNames = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];

function persistPlanDraft() {
  if (!planDraft) return;
  planDraft.title = $('new-plan-title').value;
  planDraft.valid_from = $('new-plan-date').value;
  reviewedPayload = null;
  $('plan-review').hidden = true;
  try {
    localStorage.setItem('ricettario-iphone-plan-draft', JSON.stringify(planDraft));
    $('plan-editor-status').textContent = 'Bozza salvata sul dispositivo. Il piano attivo non è stato modificato.';
  } catch (e) {
    $('plan-editor-status').textContent = 'Bozza mantenuta solo nella pagina: spazio locale insufficiente.';
  }
}

function clearPlanAttachment() {
  planPdf = null;
  if (planPdfUrl) URL.revokeObjectURL(planPdfUrl);
  planPdfUrl = null;
  $('new-plan-pdf').value = '';
  $('plan-pdf-preview').hidden = true;
  $('plan-pdf-name').textContent = '';
}

function setPlanDraft(plan) {
  planDraft = plan;
  $('new-plan-title').value = plan.title || 'Nuovo piano';
  $('new-plan-date').value = plan.valid_from || today();
  $('new-plan-date').min = today();
  $('plan-editor').hidden = false;
  $('plan-review').hidden = true;
  renderPlanDays();
  persistPlanDraft();
}
async function loadPlanManager() {
  const info = await api('/api/plans');
  const history = $('plan-history');
  history.replaceChildren();
  history.append(node('p', 'Piano iniziale · conservato nei file originali', 'muted'));
  for (const plan of info.history) {
    const row = node('div', undefined, 'panel');
    row.append(node('strong', plan.title), node('p', 'Valido dal ' + displayDate(plan.valid_from)));
    if (plan.has_pdf) {
      const link = node('a', 'Apri PDF allegato');
      link.href = await LocalAPI.pdfURL(plan.id);
      link.target = '_blank';
      link.rel = 'noopener';
      row.append(link);
    }
    history.append(row);
  }
  if (planManagerLoaded) return;
  planCatalog = await api('/api/catalog');
  planUnits = info.units;
  for (const food of planCatalog) {
    const option = node('option');
    option.value = food.display_name;
    $('plan-food-names').append(option);
  }
  $('copy-plan').onclick = () => {
    if (planDraft && !window.confirm('Sostituire la bozza con una copia del piano attuale?')) return;
    clearPlanAttachment();
    setPlanDraft({
      title: 'Nuovo piano',
      valid_from: today(),
      days: JSON.parse(JSON.stringify(info.current.days))
    });
  };
  $('blank-plan').onclick = () => {
    if (planDraft && !window.confirm('Sostituire la bozza con un piano vuoto?')) return;
    clearPlanAttachment();
    setPlanDraft({
      title: 'Nuovo piano',
      valid_from: today(),
      days: weekdayNames.map((label, i) => ({
        weekday_iso: i + 1,
        label,
        meals: mealNames.map(meal_type => ({
          meal_type,
          type: 'planned',
          items: [],
          choice_groups: [],
          notes: [],
          tags: []
        }))
      }))
    });
  };
  try {
    const saved = JSON.parse(localStorage.getItem('ricettario-iphone-plan-draft') || 'null');
    if (saved && saved.days?.length === 7) setPlanDraft(saved);
  } catch (e) {
    $('plan-editor-status').textContent = 'La bozza locale non è leggibile. Puoi iniziare un nuovo piano.';
  }
  planManagerLoaded = true;
}

function field(labelText, input) {
  const label = node('label', labelText);
  label.append(input);
  return label;
}

function planNumber(value) {
  const el = node('input');
  el.type = 'number';
  el.step = 'any';
  el.min = '0.001';
  if (value !== null && value !== undefined) el.value = value;
  return el;
}

function itemEditor(items, parent) {
  for (const item of items) {
    const row = node('div', undefined, 'editor-food');
    const name = node('input');
    name.value = item.name || '';
    name.setAttribute('list', 'plan-food-names');
    name.placeholder = 'Nome alimento';
    name.required = true;
    name.onchange = () => {
      item.name = name.value;
      const known = planCatalog.find(f => f.display_name.toLocaleLowerCase('it') === name.value.toLocaleLowerCase('it'));
      if (known && known.units_seen.length === 1) {
        item.unit = known.units_seen[0];
        unit.value = item.unit;
      }
      persistPlanDraft();
    };
    const mode = node('select');
    for (const [value, text] of [
        ['number', 'Quantità'],
        ['range', 'Intervallo'],
        ['missing', 'Non indicata']
      ]) {
      const o = node('option', text);
      o.value = value;
      mode.append(o);
    }
    mode.value = item.quantity === null ? 'missing' : typeof item.quantity === 'object' ? 'range' : 'number';
    const q = planNumber(typeof item.quantity === 'number' ? item.quantity : undefined);
    const min = planNumber(item.quantity?.min);
    const max = planNumber(item.quantity?.max);
    const numbers = node('div', undefined, 'quantity-fields');
    numbers.append(q, node('span', 'da'), min, node('span', 'a'), max);
    const renderQuantities = () => {
      q.hidden = mode.value !== 'number';
      q.required = mode.value === 'number';
      min.hidden = max.hidden = mode.value !== 'range';
      min.required = max.required = mode.value === 'range';
      for (const el of numbers.querySelectorAll('span')) el.hidden = mode.value !== 'range';
    };
    const readQuantity = () => {
      item.quantity = mode.value === 'missing' ? null : mode.value === 'range' ? {
        min: Number(min.value),
        max: Number(max.value)
      } : Number(q.value);
      persistPlanDraft();
    };
    mode.onchange = () => {
      renderQuantities();
      readQuantity();
    };
    q.oninput = min.oninput = max.oninput = readQuantity;
    renderQuantities();
    const unit = node('select');
    const unknown = node('option', 'Non indicata');
    unknown.value = '';
    unit.append(unknown);
    for (const text of planUnits) {
      unit.append(node('option', text));
    }
    unit.value = item.unit || '';
    unit.onchange = () => {
      item.unit = unit.value;
      persistPlanDraft();
    };
    const remove = node('button', 'Rimuovi');
    remove.type = 'button';
    remove.onclick = () => {
      items.splice(items.indexOf(item), 1);
      row.remove();
      persistPlanDraft();
    };
    row.append(field('Alimento', name), field('Tipo quantità', mode), field('Valore', numbers), field('Unità', unit), remove);
    parent.append(row);
  }
  const add = node('button', 'Aggiungi alimento');
  add.type = 'button';
  add.onclick = () => {
    items.push({
      name: '',
      quantity: null,
      unit: 'g'
    });
    refreshPlanEditor();
  };
  parent.append(add);
}

function refreshPlanEditor() {
  persistPlanDraft();
  renderPlanDays();
}

function renderPlanDays() {
  const root = $('plan-days');
  root.replaceChildren();
  planDraft.days.forEach((day, index) => {
    const section = node('details', undefined, 'editor-day');
    section.open = index === 0;
    section.append(node('summary', weekdayNames[index]));
    for (const meal of day.meals) {
      const card = node('div', undefined, 'editor-meal');
      card.append(node('h3', meal.meal_type[0].toUpperCase() + meal.meal_type.slice(1)));
      const free = node('input');
      free.type = 'checkbox';
      free.checked = meal.type === 'free_meal';
      card.append(field('Pasto libero', free));
      const content = node('div');
      content.hidden = free.checked;
      const outside = node('input');
      outside.type = 'checkbox';
      outside.checked = meal.tags.includes('pasto_fuori_casa');
      outside.onchange = () => {
        meal.tags = outside.checked ? ['pasto_fuori_casa'] : [];
        persistPlanDraft();
      };
      content.append(field('Fuori casa', outside));
      itemEditor(meal.items, content);
      for (const group of meal.choice_groups) {
        const groupbox = node('div', undefined, 'editor-choices');
        groupbox.append(node('p', 'Alternative: queste opzioni si escludono tra loro.', 'muted'));
        group.options.forEach((option, i) => {
          const optionbox = node('div', undefined, 'editor-option');
          optionbox.append(node('h4', 'Opzione ' + (i + 1)));
          itemEditor(option.items, optionbox);
          const remove = node('button', 'Rimuovi opzione');
          remove.type = 'button';
          remove.onclick = () => {
            group.options.splice(i, 1);
            refreshPlanEditor();
          };
          optionbox.append(remove);
          groupbox.append(optionbox);
        });
        const addOption = node('button', 'Aggiungi opzione');
        addOption.type = 'button';
        addOption.onclick = () => {
          group.options.push({
            option_id: 'opzione_' + (group.options.length + 1),
            items: []
          });
          refreshPlanEditor();
        };
        const removeGroup = node('button', 'Rimuovi gruppo di alternative');
        removeGroup.type = 'button';
        removeGroup.onclick = () => {
          meal.choice_groups.splice(meal.choice_groups.indexOf(group), 1);
          refreshPlanEditor();
        };
        groupbox.append(addOption, removeGroup);
        content.append(groupbox);
      }
      const addGroup = node('button', 'Aggiungi alternative');
      addGroup.type = 'button';
      addGroup.onclick = () => {
        meal.choice_groups.push({
          options: [{
            items: []
          }, {
            items: []
          }]
        });
        refreshPlanEditor();
      };
      content.append(addGroup);
      free.onchange = () => {
        meal.type = free.checked ? 'free_meal' : 'planned';
        content.hidden = free.checked;
        persistPlanDraft();
      };
      const notes = node('textarea');
      notes.rows = 2;
      notes.value = meal.notes.join('\n');
      notes.oninput = () => {
        meal.notes = notes.value.split('\n').filter(n => n.trim());
        persistPlanDraft();
      };
      card.append(content, field('Note del pasto', notes));
      section.append(card);
    }
    root.append(section);
  });
}
$('new-plan-title').oninput = $('new-plan-date').onchange = persistPlanDraft;
$('new-plan-pdf').onchange = async () => {
  const file = $('new-plan-pdf').files[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) {
    fail(new Error('Il PDF deve essere al massimo di 10 MB.'));
    $('new-plan-pdf').value = '';
    return;
  }
  try {
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    planPdf = {
      source_name: file.name,
      pdf_base64: data.split(',')[1]
    };
    if (planPdfUrl) URL.revokeObjectURL(planPdfUrl);
    planPdfUrl = URL.createObjectURL(file);
    $('plan-pdf-preview').href = planPdfUrl;
    $('plan-pdf-preview').hidden = false;
    $('plan-pdf-name').textContent = file.name + ' · allegato da salvare con il piano. Se chiudi la pagina, riseleziona il PDF.';
    reviewedPayload = null;
    $('plan-review').hidden = true;
  } catch (e) {
    fail(new Error('Impossibile leggere il PDF.'));
  }
};
$('plan-editor').onsubmit = async event => {
  event.preventDefault();
  persistPlanDraft();
  try {
    const preview = await post('/api/plans/preview', planDraft);
    reviewedPayload = JSON.parse(JSON.stringify(planDraft));
    const root = $('plan-review-content');
    root.replaceChildren(node('h3', preview.title), node('p', 'Valido dal ' + displayDate(preview.calendar.valid_from)));
    for (const day of preview.days) {
      const detail = node('details');
      detail.append(node('summary', weekdayNames[day.weekday_iso - 1]));
      for (const meal of day.meals) {
        detail.append(node('h4', meal.meal_type));
        if (meal.type === 'free_meal') detail.append(node('p', 'Pasto libero'));
        for (const item of meal.items) detail.append(node('p', item.name + ' · ' + quantity(item)));
        for (const group of meal.choice_groups) {
          detail.append(node('p', 'Scegli una di queste alternative:'));
          for (const option of group.options) detail.append(node('p', option.items.map(i => i.name + ' · ' + quantity(i)).join(' + ')));
        }
        for (const note of meal.notes) detail.append(node('p', note));
      }
      root.append(detail);
    }
    $('plan-reviewed').checked = false;
    $('plan-review').hidden = false;
    $('error').hidden = true;
    $('plan-review').scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  } catch (e) {
    fail(e);
  }
};
$('back-plan-edit').onclick = () => {
  $('plan-review').hidden = true;
  $('plan-editor').scrollIntoView({
    behavior: 'smooth'
  });
};
$('save-new-plan').onclick = async () => {
  if (!reviewedPayload || !$('plan-reviewed').checked) {
    fail(new Error('Verifica l’anteprima e spunta la conferma prima di salvare.'));
    return;
  }
  const button = $('save-new-plan');
  button.disabled = true;
  try {
    const result = await post('/api/plans/save', {
      ...reviewedPayload,
      reviewed: true,
      ...(planPdf || {})
    });
    localStorage.removeItem('ricettario-iphone-plan-draft');
    planDraft = null;
    reviewedPayload = null;
    planPdf = null;
    $('plan-editor').hidden = $('plan-review').hidden = true;
    $('plan-editor-status').textContent = 'Nuovo piano salvato. Sarà usato dal ' + displayDate(result.valid_from) + '. Crea una spesa con il nuovo piano per configurare i consumi della dispensa.';
    $('error').hidden = true;
    planManagerLoaded = false;
    await loadPlanManager();
    await show(today());
  } catch (e) {
    fail(e);
  } finally {
    button.disabled = false;
  }
};
