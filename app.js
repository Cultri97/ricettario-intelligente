/** Calendario e rendering dei pasti. Espone helper usati dagli script successivi. Non cambiare l’ordine defer in index.html. */
'use strict';
const $ = id => document.getElementById(id);
const localDate = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const today = () => localDate(new Date());
const tomorrow = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return localDate(d);
};
const node = (tag, text, cls) => {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (cls) el.className = cls;
  return el;
};
let requestNumber = 0;
async function api(url, options) {
  await window.RicettarioReady;
  return window.LocalAPI.request(url, options);
}

function fail(e) {
  $('error').hidden = false;
  $('error').textContent = e.message || 'Operazione non riuscita. I dati sono conservati su questo dispositivo.';
}

function quantity(item) {
  const q = item.quantity;
  if (q === null) return 'Quantità non indicata';
  return `${typeof q==='object'?`${q.min}–${q.max}`:q} ${item.unit || ''}`.trim();
}

function items(list, parent) {
  const ul = node('ul');
  for (const item of list) {
    const li = node('li', undefined, 'food-row');
    if (!item.substitutions?.some(rule => rule.alternatives.length)) {
      const row = node('div', undefined, 'food-static');
      row.append(node('span', item.name, 'food-label'), node('strong', quantity(item)));
      li.append(row);
      ul.append(li);
      continue;
    }
    const details = node('details', undefined, 'food-detail');
    const summary = node('summary', undefined, 'food-summary');
    const label = node('span', undefined, 'food-label');
    label.append(node('span', item.name), node('small', 'Sostituzioni', 'food-hint'));
    summary.append(label, node('strong', quantity(item)));
    details.append(summary);
    const body = node('div', undefined, 'substitution-body');
    if (!item.substitutions || !item.substitutions.length) {
      body.append(node('p', item.substitution_notice || 'Nessuna sostituzione disponibile.', 'muted'));
    } else {
      body.append(node('p', item.substitutions.some(rule => rule.combination) ? 'Alternative per la combinazione del pasto:' : 'Puoi sostituire ' + quantity(item) + ' di ' + item.name + ' con:', 'substitution-heading'));
      for (const rule of item.substitutions) {
        if (rule.combination) body.append(node('p', 'Per l’intera combinazione: ' + rule.context_label, 'note'));
        const options = node('ul', undefined, 'substitution-options');
        for (const option of rule.alternatives) {
          const row = node('li');
          row.append(node('span', option.label));
          if (option.status === 'select_quantity') row.append(node('small', 'Quantità da scegliere nell’intervallo indicato.', 'muted'));
          if (option.status === 'select_food') row.append(node('small', 'Tipo di alimento da scegliere.', 'muted'));
          for (const text of [...option.notes, ...option.limit_texts]) row.append(node('small', text, 'muted'));
          options.append(row);
        }
        body.append(options);
        for (const note of rule.notes) body.append(node('p', note, 'note'));
      }
      body.append(node('p', 'Consulta le alternative; il pasto rimane invariato.', 'muted'));
    }
    details.append(body);
    li.append(details);
    ul.append(li);
  }
  parent.append(ul);
}

function mealCard(meal, index) {
  const secondary = ['spuntino', 'merenda'].includes(meal.meal_type);
  const card = node('article', undefined, secondary ? 'meal meal-secondary' : 'meal meal-main');
  const top = node('div', undefined, 'meal-top');
  const title = node('h3', meal.meal_type[0].toUpperCase() + meal.meal_type.slice(1));
  top.append(node('span', String(index + 1).padStart(2, '0'), 'number'), title);
  if (meal.tags.includes('pasto_fuori_casa') || meal.tags.includes('in_pasticceria')) top.append(node('span', 'Fuori casa', 'badge'));
  if (meal.type === 'free_meal') top.append(node('span', 'Pasto libero', 'badge free'));
  card.append(top);
  items(meal.items, card);
  if (meal.type === 'free_meal') card.append(node('p', 'Pasto libero previsto dal piano.', 'muted'));
  for (const group of meal.choice_groups) {
    const choices = node('div', undefined, 'choices');
    choices.append(node('p', 'Alternative del piano · scegli una delle opzioni', 'eyebrow'));
    group.options.forEach((option, i) => {
      if (i) choices.append(node('p', 'oppure', 'or'));
      items(option.items, choices);
    });
    card.append(choices);
  }
  for (const note of meal.notes) card.append(node('p', note, 'note'));
  return card;
}
async function show(value) {
  const current = ++requestNumber;
  try {
    const data = await api('/api/day?date=' + encodeURIComponent(value));
    if (current !== requestNumber) return;
    $('error').hidden = true;
    $('date').value = value;
    const parsed = new Date(value + 'T12:00:00');
    $('daytitle').textContent = new Intl.DateTimeFormat('it-IT', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    }).format(parsed);
    $('relative').textContent = value === today() ? 'OGGI' : value === tomorrow() ? 'DOMANI' : 'IL GIORNO SELEZIONATO';
    for (const [id, v] of [
        ['today', today()],
        ['tomorrow', tomorrow()]
      ]) {
      $(id).classList.toggle('active', value === v);
      $(id).setAttribute('aria-pressed', String(value === v));
    }
    $('meals').replaceChildren();
    data.day.meals.forEach((m, i) => $('meals').append(mealCard(m, i)));
    $('count').textContent = '5 pasti · ' + (data.plan_title || 'Piano del giorno');
    $('validity').textContent = 'Piano settimanale ricorrente';
  } catch (e) {
    if (current === requestNumber) fail(e);
  }
}
async function init() {
  try {
    const available = await window.RicettarioReady;
    $('onboarding').hidden = available;
    $('application').hidden = !available;
    if (available) await show(today());
  } catch (error) {
    $('startup-error').textContent = error.message;
  }
}
$('today').onclick = () => show(today());
$('tomorrow').onclick = () => show(tomorrow());
$('date').onchange = () => {
  if ($('date').value) show($('date').value);
};
// Aggiorna Oggi quando si ritorna alla scheda, anche dopo mezzanotte.
let lastToday = today();
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && lastToday !== today()) {
    const previous = lastToday;
    lastToday = today();
    if ($('date').value === previous) show(today());
  }
});
init();
