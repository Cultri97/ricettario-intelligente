/** Motore locale puro. Non legge rete, DOM o IndexedDB. */
export const SCHEMA = 1;
export const MEALS = ['colazione', 'spuntino', 'pranzo', 'merenda', 'cena'];
export const DAYS = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
export const UNITS = ['g', 'ml', 'fette', 'cucchiaini', 'cucchiai', 'pezzi', 'pezzo', 'bottiglia', 'vasetto'];
export const ORIGINAL = 'piano_originale_01';
export const DOCUMENTS = ['piano_settimanale.json', 'sostituzioni.json', 'regole_e_indicazioni.json', 'catalogo_alimenti.json'];
const clone = value => JSON.parse(JSON.stringify(value));
const pair = item => JSON.stringify([item.food_id, item.unit]);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const round = n => Math.round(n * 1e10) / 1e10;
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
export function iso(value) {
  assert(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), 'Data non valida.');
  const d = new Date(value + 'T12:00:00Z');
  assert(!Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === value, 'Data non valida.');
  return value;
}
export function shift(value, days) {
  const d = new Date(iso(value) + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d.toISOString().slice(0, 10));
}
export const weekday = value => ((new Date(iso(value) + 'T12:00:00Z').getUTCDay() + 6) % 7) + 1;
export function number(value, positive = false) {
  assert(typeof value !== 'boolean' && value !== null && value !== '' && ['number', 'string'].includes(typeof value), 'Inserisci una quantità numerica.');
  const n = Number(value);
  assert(Number.isFinite(n) && n >= 0 && (!positive || n > 0) && n <= 10000000, 'La quantità deve essere valida e non negativa.');
  return n;
}

function text(value, label = 'Testo', limit = 300) {
  assert(typeof value === 'string' && value.trim() && value.length <= limit, label + ' non valido.');
  return value.trim();
}
const nextId = items => Math.max(0, ...items.map(item => item.id || 0)) + 1;
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
export function newState() {
  return {
    schema_version: SCHEMA,
    imported: false,
    documents: {},
    plans: [],
    user_foods: [],
    shopping: [],
    pantry: [],
    consumption: [],
    consumption_log: [],
    movements: [],
    accesses: [],
    recurrence_versions: [],
    last_backup_at: null
  };
}
export function catalog(state) {
  const known = new Map((state.documents['catalogo_alimenti.json']?.foods || []).map(f => [f.food_id, clone(f)]));
  for (const item of state.user_foods) {
    if (known.has(item.food_id)) known.get(item.food_id).units_seen = [...new Set([...known.get(item.food_id).units_seen, ...item.units_seen])].sort();
    else known.set(item.food_id, clone(item));
  }
  return [...known.values()].sort((a, b) => a.display_name.localeCompare(b.display_name, 'it'));
}
export function current(state, day) {
  iso(day);
  const versions = state.plans.filter(p => p.valid_from <= day).sort((a, b) => compare(b.valid_from, a.valid_from));
  const plan = versions[0]?.content || state.documents['piano_settimanale.json'];
  assert(plan, 'Importa prima il tuo archivio personale.');
  return plan;
}

function dayPlan(state, day) {
  return current(state, day).days[weekday(day) - 1];
}

function upsert(list, match, value) {
  const index = list.findIndex(match);
  if (index < 0) list.push(value);
  else list[index] = value;
}

function stock(state, food, unit) {
  return state.pantry.find(p => p.food_id === food && p.unit === unit);
}

function movement(state, day, food, unit, quantity, reason) {
  if (quantity > 0) state.movements.push({
    id: nextId(state.movements),
    day,
    food_id: food,
    unit,
    quantity,
    reason
  });
}
/** Recupera solo i giorni trascorsi, una sola volta e dalla validità del modello. */
export function sync(state, today) {
  iso(today);
  const first = state.consumption.map(c => c.day).sort()[0];
  if (first) {
    assert((new Date(today + 'T12:00:00Z') - new Date(first + 'T12:00:00Z')) / 86400000 < 36500, 'Archivio con intervallo di consumo eccessivo.');
    const scheduled = new Set(state.consumption.map(c => c.day));
    for (let day = first; day < today; day = shift(day, 1)) {
      if (scheduled.has(day)) continue;
      const pid = current(state, day).plan_id;
      const template = state.recurrence_versions.filter(r => r.plan_id === pid && r.weekday === weekday(day) && r.valid_from <= day).sort((a, b) => compare(b.valid_from, a.valid_from))[0];
      if (template) state.consumption.push({
        day,
        items: clone(template.items),
        processed: false
      });
    }
  }
  for (const record of state.consumption.filter(c => c.day < today && !c.processed).sort((a, b) => compare(a.day, b.day))) {
    for (const item of record.items) {
      const entry = stock(state, item.food_id, item.unit);
      const used = Math.min(entry?.quantity || 0, item.quantity);
      if (entry) entry.quantity = round(entry.quantity - used);
      state.consumption_log.push({
        day: record.day,
        food_id: item.food_id,
        unit: item.unit,
        needed: item.quantity,
        used
      });
      movement(state, record.day, item.food_id, item.unit, used, 'consumo automatico');
    }
    record.processed = true;
  }
}

function matches(source, item, policy) {
  let same = source.food_id === item.food_id;
  if (policy === 'legumi_cotti_120_compresi_ceci_in_scatola_scolati') same = ['legumi_cotti', 'ceci_scatola_scolati'].includes(item.food_id);
  if (!same || source.unit !== item.unit) return false;
  if (policy === 'combinazione_fette_e_marmellata' && source.quantity === null) return item.quantity !== null;
  return equal(source.quantity, item.quantity);
}

function lookup(item, context, rules, limits) {
  return rules.filter(rule => rule.source_items.some(s => matches(s, item, rule.matching_policy)) && rule.source_items.every(s => context.some(x => matches(s, x, rule.matching_policy)))).map(original => {
    const rule = clone(original);
    rule.combination = rule.source_items.length > 1;
    rule.context_label = rule.source_items.flatMap(s => context.filter(x => matches(s, x, rule.matching_policy)).map(x => `${x.quantity} ${x.unit} ${x.name}`)).join(' + ');
    if (rule.matching_policy === 'combinazione_fette_e_marmellata') rule.notes.push('La sostituzione riguarda fette biscottate e marmellata insieme. La regola non specifica la quantità di marmellata; quella nel pasto resta indicata sopra.');
    for (const option of rule.alternatives) option.limit_texts = option.limits.filter(k => limits[k]).map(k => limits[k]);
    return rule;
  });
}
const limitsOf = state => Object.fromEntries((state.documents['regole_e_indicazioni.json']?.weekly_limits || []).map(r => [r.id, r.source_text]));
const rulesOf = (state, pid) => pid === ORIGINAL ? state.documents['sostituzioni.json']?.rules || [] : [];
export function enrichedDay(state, day) {
  const result = clone(dayPlan(state, day));
  const rules = rulesOf(state, current(state, day).plan_id);
  const limits = limitsOf(state);
  for (const meal of result.meals) {
    const contexts = [
      [meal.items, meal.items], ...meal.choice_groups.flatMap(g => g.options.map(o => [o.items, [...meal.items, ...o.items]]))
    ];
    for (const [items, context] of contexts)
      for (const item of items) {
        item.substitutions = lookup(item, context, rules, limits);
        item.substitution_notice = '';
      }
  }
  return result;
}
export function describe(item) {
  const q = item.quantity;
  const value = q === null ? 'Quantità da indicare' : typeof q === 'object' ? `${q.min}–${q.max}` : String(q);
  return `${value} ${item.unit || ''} ${item.name}`;
}

function personalize(entries, key, rules, limits, selected) {
  const context = entries.map(e => e[1]);
  const groups = new Map();
  for (const item of context)
    for (const rule of lookup(item, context, rules, limits)) {
      const indices = entries.map((e, i) => rule.source_items.some(s => matches(s, e[1], rule.matching_policy)) ? i : -1).filter(i => i >= 0);
      const label = indices.join(',');
      if (!groups.has(label)) groups.set(label, {
        indices,
        rules: []
      });
      if (!groups.get(label).rules.some(r => r.rule_id === rule.rule_id)) groups.get(label).rules.push(rule);
    }
  const slots = [];
  const removed = new Set();
  const replacements = [];
  for (const [label, group] of groups) {
    const slotkey = key + '/sub/' + label;
    const options = group.rules.flatMap(rule => rule.alternatives.map(option => ({
      id: option.option_id,
      label: option.label,
      notes: [...rule.notes, ...option.notes, ...option.limit_texts],
      disabled: option.status === 'select_food'
    })));
    slots.push({
      key: slotkey,
      label: group.indices.map(i => describe(entries[i][1])).join(' + '),
      options
    });
    if (!selected[slotkey]) continue;
    const option = group.rules.flatMap(r => r.alternatives).find(o => o.option_id === selected[slotkey]);
    assert(option && option.status !== 'select_food', 'Sostituzione non disponibile per questa porzione.');
    assert(!group.indices.some(i => removed.has(i)), 'Due sostituzioni coinvolgono lo stesso alimento: scegline una sola.');
    group.indices.forEach(i => removed.add(i));
    option.items.forEach((item, i) => replacements.push([`${slotkey}/${option.option_id}/${i}`, item]));
  }
  for (const [selectedkey, option] of Object.entries(selected)) assert(!option || !selectedkey.startsWith(key + '/sub/') || slots.some(s => s.key === selectedkey), 'Le scelte del pasto sono cambiate: riapri la personalizzazione.');
  return {
    entries: [...entries.filter((e, i) => !removed.has(i)), ...replacements],
    slots
  };
}

function aggregate(items) {
  const map = new Map();
  for (const item of items) {
    const key = pair(item);
    if (!map.has(key)) map.set(key, {
      ...clone(item),
      quantity: 0
    });
    map.get(key).quantity = round(map.get(key).quantity + item.quantity);
  }
  return [...map.values()];
}
export function build(state, data, today) {
  const start = iso(data.start);
  const end = iso(data.end);
  assert(start <= end && (new Date(end + 'T12:00:00Z') - new Date(start + 'T12:00:00Z')) / 86400000 <= 92, 'Scegli un intervallo da 1 a 93 giorni.');
  const selections = data.selections || {};
  const quantities = data.quantities || {};
  const replacements = data.personalize ? data.replacements || {} : {};
  const issues = [],
    all = [],
    excluded = [],
    customization = [];
  const schedule = {};
  const used = new Set();

  function add(item, key, day) {
    let quantity = item.quantity;
    if (quantity === null || typeof quantity === 'object') {
      if (!own(quantities, key)) {
        issues.push({
          kind: 'quantity',
          key,
          label: day + ' · ' + item.name,
          range: quantity,
          unit: item.unit
        });
        return;
      }
      assert(item.unit, 'Prima di includere ' + item.name + ' nella spesa, indica l’unità nel piano.');
      quantity = number(quantities[key], true);
      if (item.quantity && typeof item.quantity === 'object') assert(item.quantity.min <= quantity && quantity <= item.quantity.max, 'La quantità deve rispettare l’intervallo del piano.');
    }
    const entry = {
      food_id: item.food_id,
      name: item.name,
      unit: item.unit,
      quantity
    };
    all.push(entry);
    schedule[day].push(entry);
  }
  for (let day = start; day <= end; day = shift(day, 1)) {
    schedule[day] = [];
    const active = current(state, day);
    for (const meal of active.days[weekday(day) - 1].meals) {
      const key = day + '/' + meal.meal_id;
      if (meal.type === 'free_meal') {
        excluded.push(`${day} · ${meal.meal_type}: pasto libero`);
        continue;
      }
      if (data.exclude_outside !== false && meal.tags.includes('pasto_fuori_casa')) {
        excluded.push(`${day} · ${meal.meal_type}: fuori casa`);
        continue;
      }
      let entries = meal.items.map((item, i) => [key + '/' + i, item]);
      meal.choice_groups.forEach((group, i) => {
        const groupkey = key + '/choice/' + i;
        const choice = selections[groupkey];
        if (choice === null || choice === undefined || choice === '') {
          issues.push({
            kind: 'choice',
            key: groupkey,
            label: `${day} · ${meal.meal_type}`,
            options: group.options.map(o => ({
              id: o.option_id,
              label: o.items.map(describe).join(' + ')
            }))
          });
          return;
        }
        const option = group.options.find(o => o.option_id === choice);
        assert(option, 'Alternativa non valida.');
        entries.push(...option.items.map((item, j) => [groupkey + '/' + choice + '/' + j, item]));
      });
      if (data.personalize) {
        const personalized = personalize(entries, key, rulesOf(state, active.plan_id), limitsOf(state), replacements);
        entries = personalized.entries;
        for (const slot of personalized.slots) {
          slot.meal = day + ' · ' + meal.meal_type;
          used.add(slot.key);
          customization.push(slot);
        }
      }
      for (const [entrykey, item] of entries) add(item, entrykey, day);
    }
    schedule[day] = aggregate(schedule[day]);
  }
  assert(!Object.entries(replacements).some(([key, value]) => value && !used.has(key)), 'Le date o i pasti sono cambiati: riapri la personalizzazione.');
  sync(state, today);
  const rows = [],
    covered = [];
  const totals = aggregate(all).sort((a, b) => compare(a.food_id, b.food_id) || compare(a.unit, b.unit));
  totals.forEach((item, i) => {
    const available = stock(state, item.food_id, item.unit)?.quantity || 0;
    const needed = round(Math.max(0, item.quantity - available));
    const row = {
      ...item,
      id: String(i),
      required: item.quantity,
      available,
      to_buy: needed,
      purchased: needed,
      checked: false
    };
    (needed ? rows : covered).push(row);
  });
  const personalization_labels = customization.filter(s => replacements[s.key]).map(s => `${s.meal} · ${s.label} → ${s.options.find(o => o.id === replacements[s.key]).label}`);
  return {
    start,
    end,
    issues,
    rows,
    covered,
    excluded,
    schedule,
    customization,
    replacements,
    personalization_labels
  };
}
export function inventory(state, today) {
  sync(state, today);
  const shortages = state.consumption_log.filter(x => x.needed > x.used).sort((a, b) => compare(b.day, a.day)).slice(0, 30).map(x => ({
    date: x.day,
    food: x.food_id,
    unit: x.unit,
    missing: round(x.needed - x.used)
  }));
  return {
    items: clone(state.pantry).sort((a, b) => a.name.localeCompare(b.name, 'it')),
    shortages
  };
}

function setStock(state, data, today) {
  const food = catalog(state).find(f => f.food_id === data.food_id);
  assert(food, 'Alimento sconosciuto.');
  let unit = data.unit,
    quantity = number(data.quantity);
  if (unit === 'kg') {
    unit = 'g';
    quantity *= 1000;
  }
  assert(UNITS.includes(unit) && food.units_seen.includes(unit), 'Scegli un’unità prevista per questo alimento: ' + food.units_seen.join(', '));
  sync(state, today);
  const old = stock(state, data.food_id, unit);
  if (old && old.quantity > quantity) movement(state, today, data.food_id, unit, round(old.quantity - quantity), 'correzione manuale');
  upsert(state.pantry, p => p.food_id === data.food_id && p.unit === unit, {
    food_id: data.food_id,
    unit,
    name: food.display_name,
    quantity
  });
  return {
    ok: true
  };
}

function createList(state, data, today) {
  assert(!state.shopping.some(s => s.status === 'open'), 'Hai già una lista aperta. Completala oppure eliminala prima di crearne un’altra.');
  const result = build(state, data, today);
  if (result.issues.length) return result;
  if (data.personalize && Object.values(data.replacements || {}).some(Boolean)) {
    const baseline = build(state, {
      ...data,
      personalize: false,
      replacements: {}
    }, today);
    assert(!baseline.issues.length, 'Completa prima anche le quantità del piano originale per i consumi delle settimane successive.');
    result.recurring_schedule = baseline.schedule;
  }
  const id = nextId(state.shopping);
  state.shopping.push({
    ...clone(result),
    id,
    status: 'open',
    created: today
  });
  return {
    ...result,
    id
  };
}

function openList(state, id) {
  const list = state.shopping.find(s => s.id === id);
  assert(list?.status === 'open', 'La lista non è modificabile.');
  return list;
}

function updateList(state, data) {
  const row = openList(state, data.id).rows.find(r => r.id === data.row_id);
  assert(row && typeof data.checked === 'boolean', 'Articolo non valido.');
  row.purchased = number(data.purchased, true);
  row.checked = data.checked;
  return {
    ok: true
  };
}

function completeList(state, data, today) {
  sync(state, today);
  const list = state.shopping.find(s => s.id === data.id);
  assert(list, 'Lista inesistente.');
  if (list.status === 'completed') return {
    ok: true
  };
  assert(!list.rows.some(r => !r.checked), 'Spunta tutti gli articoli comprati prima di completare la spesa.');
  assert(list.end >= today, 'L’intervallo è già trascorso: crea una lista per le date attuali.');
  for (const [day, items] of Object.entries(list.recurring_schedule || list.schedule)) {
    const plan_id = current(state, day).plan_id;
    const entry = {
      plan_id,
      weekday: weekday(day),
      valid_from: day > today ? day : today,
      items: clone(items)
    };
    upsert(state.recurrence_versions, r => r.plan_id === plan_id && r.weekday === entry.weekday && r.valid_from === entry.valid_from, entry);
  }
  for (const [day, items] of Object.entries(list.schedule)) {
    if (day < today) continue;
    const existing = state.consumption.find(c => c.day === day);
    assert(!existing || equal(existing.items, items), 'Esiste già una spesa completata con scelte diverse per il ' + day + '. Usa un intervallo diverso.');
    if (!existing) state.consumption.push({
      day,
      items: clone(items),
      processed: false
    });
  }
  for (const row of list.rows) {
    const existing = stock(state, row.food_id, row.unit);
    if (existing) existing.quantity = round(existing.quantity + row.purchased);
    else state.pantry.push({
      food_id: row.food_id,
      unit: row.unit,
      name: row.name,
      quantity: row.purchased
    });
  }
  list.status = 'completed';
  return {
    ok: true
  };
}

function access(state, data, today, now) {
  const token = text(data.token, 'Accesso', 100);
  const existing = state.accesses.find(a => a.token === token);
  if (existing) return existing.report;
  const previous = state.accesses.at(-1);
  const baseline = previous ? previous.movement_id : Math.max(0, ...state.movements.map(m => m.id));
  sync(state, today);
  const names = new Map(catalog(state).map(f => [f.food_id, f.display_name]));
  const totals = new Map();
  const details = [];
  for (const item of state.movements.filter(m => m.id > baseline).sort((a, b) => compare(a.day, b.day) || a.id - b.id)) {
    const key = pair(item);
    if (!totals.has(key)) totals.set(key, {
      food_id: item.food_id,
      name: names.get(item.food_id) || item.food_id,
      unit: item.unit,
      quantity: 0
    });
    totals.get(key).quantity = round(totals.get(key).quantity + item.quantity);
    details.push({
      date: item.day,
      name: names.get(item.food_id) || item.food_id,
      unit: item.unit,
      quantity: item.quantity,
      reason: item.reason
    });
  }
  const report = {
    previous_access: previous?.accessed || null,
    accessed: now,
    items: [...totals.values()],
    details
  };
  state.accesses.push({
    id: nextId(state.accesses),
    token,
    accessed: now,
    movement_id: Math.max(0, ...state.movements.map(m => m.id)),
    report
  });
  return report;
}
/** Valida l'editor. Le quantità assenti restano assenti. */
export function validatePlan(state, data, today) {
  const title = text(data.title, 'Nome del piano', 120);
  const valid = iso(data.valid_from);
  assert(valid >= today, 'Il nuovo piano deve iniziare oggi o in una data futura, per conservare lo storico.');
  assert(Array.isArray(data.days) && data.days.length === 7, 'Servono sette giorni completi.');
  const known = new Map(catalog(state).map(f => [f.display_name.toLocaleLowerCase('it'), f]));
  const additions = new Map();

  function item(raw) {
    const name = text(raw?.name, 'Alimento');
    const unit = raw.unit || '';
    const q = raw.quantity;
    assert(UNITS.includes(unit) || (unit === '' && q === null), 'Indica un’unità per ' + name);
    if (q !== null) {
      if (typeof q === 'object') {
        assert(q && equal(Object.keys(q).sort(), ['max', 'min']), 'Intervallo non valido.');
        assert(number(q.min, true) < number(q.max, true), 'Intervallo non valido per ' + name);
      } else assert(typeof q === 'number' && number(q, true) <= 1000000, 'Le quantità devono essere positive e valide.');
    }
    const existing = known.get(name.toLocaleLowerCase('it'));
    const id = existing?.food_id || 'iphone_' + [...new TextEncoder().encode(name.toLocaleLowerCase('it'))].map(b => b.toString(16).padStart(2, '0')).join('');
    if (!additions.has(id)) additions.set(id, {
      food_id: id,
      display_name: existing?.display_name || name,
      units_seen: [...(existing?.units_seen || [])]
    });
    if (!additions.get(id).units_seen.includes(unit)) additions.get(id).units_seen.push(unit);
    return {
      food_id: id,
      name: existing?.display_name || name,
      unit,
      quantity: clone(q)
    };
  }
  const days = data.days.map((day, i) => {
    assert(day.weekday_iso === i + 1 && Array.isArray(day.meals) && day.meals.length === 5, 'Ogni giorno deve avere i cinque pasti in ordine.');
    const meals = day.meals.map((meal, index) => {
      const kind = MEALS[index];
      assert(meal.meal_type === kind, 'Ordine dei pasti non valido.');
      assert(Array.isArray(meal.items) && meal.items.length <= 40 && Array.isArray(meal.choice_groups) && meal.choice_groups.length <= 10, 'Troppi alimenti o alternative.');
      const free = meal.type === 'free_meal';
      const items = free ? [] : meal.items.map(item);
      const groups = free ? [] : meal.choice_groups.map((group, j) => {
        assert(Array.isArray(group.options) && group.options.length >= 2 && group.options.length <= 10, 'Ogni gruppo di alternative richiede almeno due opzioni.');
        const options = group.options.map((option, k) => {
          assert(Array.isArray(option.items) && option.items.length >= 1 && option.items.length <= 40, 'Ogni alternativa deve contenere almeno un alimento.');
          return {
            option_id: 'opzione_' + (k + 1),
            items: option.items.map(item)
          };
        });
        return {
          group_id: 'gruppo_' + (j + 1),
          options,
          default_option_id: options[0].option_id
        };
      });
      assert(free || items.length || groups.length, DAYS[i] + ' · ' + kind + ': inserisci gli alimenti oppure indica Pasto libero.');
      assert(Array.isArray(meal.notes) && meal.notes.length <= 100 && meal.notes.every(n => typeof n === 'string' && n.length <= 3000), 'Note non valide.');
      return {
        meal_id: `giorno_${i + 1}_${kind}`,
        meal_type: kind,
        type: free ? 'free_meal' : 'planned',
        items,
        choice_groups: groups,
        tags: meal.tags?.includes('pasto_fuori_casa') ? ['pasto_fuori_casa'] : [],
        notes: clone(meal.notes),
        source_text: '',
        source_page: null
      };
    });
    return {
      weekday_iso: i + 1,
      label: DAYS[i],
      day_id: 'giorno_' + (i + 1),
      meals
    };
  });
  return {
    plan: {
      title,
      plan_id: '',
      calendar: {
        repeat: 'weekly',
        valid_from: valid
      },
      meal_order: MEALS,
      days
    },
    additions: [...additions.values()]
  };
}

function savePlan(state, data, today, now) {
  const {
    plan,
    additions
  } = validatePlan(state, data, today);
  assert(data.reviewed === true, 'Conferma di aver verificato alimenti e quantità prima di salvare.');
  assert(!state.plans.some(p => p.valid_from >= plan.calendar.valid_from), 'Esiste già un piano con data uguale o successiva. Scegli una data successiva.');
  assert(!state.shopping.some(s => s.status === 'open' && s.end >= plan.calendar.valid_from), 'Completa o elimina la lista aperta che comprende il nuovo periodo, poi salva il piano.');
  if (data.pdf_base64) {
    validatePdf(data.pdf_base64);
    text(data.source_name, 'Nome PDF', 250);
  }
  const id = nextId(state.plans);
  plan.plan_id = 'iphone_plan_' + id;
  state.plans.push({
    id,
    valid_from: plan.calendar.valid_from,
    title: plan.title,
    content: plan,
    pdf_base64: data.pdf_base64 || null,
    source_name: data.pdf_base64 ? data.source_name : '',
    created: now
  });
  for (const food of additions) upsert(state.user_foods, f => f.food_id === food.food_id, food);
  state.consumption = state.consumption.filter(c => c.processed || c.day < plan.calendar.valid_from);
  return {
    ok: true,
    plan_id: plan.plan_id,
    valid_from: plan.calendar.valid_from
  };
}

function validatePdf(encoded) {
  assert(typeof encoded === 'string' && encoded.length <= 13981016 && /^[A-Za-z0-9+/]*={0,2}$/.test(encoded), 'Allegato PDF non valido o superiore a 10 MB.');
  let raw;
  try {
    raw = atob(encoded);
  } catch {
    throw new Error('Allegato PDF non valido.');
  }
  assert(raw.length <= 10 * 1024 * 1024 && raw.startsWith('%PDF-'), 'Seleziona un PDF valido, massimo 10 MB.');
}
/** Confine transazionale: nessuna modifica del chiamante se un'operazione fallisce. */
export function execute(input, method, url, data = {}, clock) {
  const state = clone(input);
  const {
    today,
    now
  } = clock;
  iso(today);
  assert(state.imported, 'Importa prima il tuo archivio personale.');
  const target = new URL(url, 'https://local.invalid');
  const path = target.pathname;
  let result;
  if (method === 'GET') {
    if (path === '/api/day') {
      const day = target.searchParams.get('date') || today;
      result = {
        date: iso(day),
        day: enrichedDay(state, day),
        plan_title: current(state, day).title
      };
    } else if (path === '/api/catalog') result = catalog(state);
    else if (path === '/api/plans') result = {
      current: current(state, today),
      history: state.plans.slice().sort((a, b) => compare(b.valid_from, a.valid_from)).map(p => ({
        id: p.id,
        valid_from: p.valid_from,
        title: p.title,
        has_pdf: !!p.pdf_base64,
        source_name: p.source_name
      })),
      units: UNITS
    };
    else if (path === '/api/lists') result = state.shopping.slice().sort((a, b) => b.id - a.id);
    else if (path === '/api/pantry') result = inventory(state, today);
    else if (path === '/api/info') result = {
      rules: state.documents['regole_e_indicazioni.json']?.rules || []
    };
    else throw new Error('Pagina non trovata.');
  } else if (method === 'POST') {
    if (path === '/api/shopping/preview') result = build(state, data, today);
    else if (path === '/api/shopping/create') result = createList(state, data, today);
    else if (path === '/api/shopping/update') result = updateList(state, data);
    else if (path === '/api/shopping/delete') {
      openList(state, data.id);
      state.shopping = state.shopping.filter(s => s.id !== data.id);
      result = {
        ok: true
      };
    } else if (path === '/api/shopping/complete') result = completeList(state, data, today);
    else if (path === '/api/pantry/set') result = setStock(state, data, today);
    else if (path === '/api/access') result = access(state, data, today, now);
    else if (path === '/api/plans/preview') result = validatePlan(state, data, today).plan;
    else if (path === '/api/plans/save') result = savePlan(state, data, today, now);
    else throw new Error('Operazione non disponibile.');
  } else throw new Error('Metodo non disponibile.');
  return {
    state,
    result: clone(result)
  };
}

// Il backup non viene mai eseguito come codice. Tutto il testo passa per textContent.
function validateItem(item, scheduled = false) {
  assert(item && typeof item === 'object', 'Alimento non valido.');
  text(item.food_id, 'Codice alimento', 3000);
  text(item.name, 'Nome alimento', 1200);
  assert(typeof item.unit === 'string' || item.unit === null, 'Unità non valida.');
  const q = item.quantity;
  if (q === null) {
    assert(!scheduled, 'Consumo programmato privo di quantità.');
    return;
  }
  if (typeof q === 'object') {
    assert(!scheduled && q && equal(Object.keys(q).sort(), ['max', 'min']) && number(q.min, true) < number(q.max, true), 'Intervallo non valido.');
  } else assert(typeof q === 'number' && number(q) >= 0, 'Quantità non valida nell’archivio.');
  if (scheduled) assert(typeof item.unit === 'string' && item.unit.length > 0, 'Consumo programmato privo di unità.');
}

function validateStoredPlan(plan) {
  text(plan?.plan_id, 'Identificatore piano', 300);
  text(plan.title, 'Nome piano', 300);
  assert(Array.isArray(plan.days) && plan.days.length === 7, 'Il piano deve contenere sette giorni.');
  const ids = new Set();
  plan.days.forEach((day, i) => {
    assert(day.weekday_iso === i + 1 && Array.isArray(day.meals) && day.meals.length === 5, 'Il piano deve contenere 35 pasti ordinati.');
    day.meals.forEach((meal, j) => {
      assert(meal.meal_type === MEALS[j] && !ids.has(meal.meal_id), 'Pasto duplicato o non valido.');
      ids.add(text(meal.meal_id, 'Pasto', 300));
      assert(['planned', 'free_meal'].includes(meal.type) && Array.isArray(meal.items) && meal.items.length <= 40 && Array.isArray(meal.choice_groups) && meal.choice_groups.length <= 10, 'Pasto non valido.');
      meal.items.forEach(x => validateItem(x));
      assert(Array.isArray(meal.tags) && meal.tags.every(t => typeof t === 'string') && Array.isArray(meal.notes) && meal.notes.every(n => typeof n === 'string'), 'Note o etichette non valide.');
      if (meal.type === 'free_meal') assert(!meal.items.length && !meal.choice_groups.length, 'Un pasto libero non può avere ingredienti.');
      for (const group of meal.choice_groups) {
        assert(Array.isArray(group.options) && group.options.length >= 2 && group.options.length <= 10, 'Alternative del piano non valide.');
        const optionIds = new Set();
        for (const option of group.options) {
          assert(!optionIds.has(option.option_id) && Array.isArray(option.items) && option.items.length > 0 && option.items.length <= 40, 'Opzione non valida.');
          optionIds.add(text(option.option_id));
          option.items.forEach(x => validateItem(x));
        }
      }
    });
  });
}

function unique(list, key, message) {
  const keys = list.map(key);
  assert(new Set(keys).size === keys.length, message);
}
/** Valida l'intero archivio prima di sostituire qualunque dato del dispositivo. */
export function validateBackup(packageData) {
  assert(packageData?.kind === 'ricettario-iphone-backup' && packageData.version === SCHEMA, 'Questo file non è un backup di Ricettario Intelligente compatibile.');
  const state = clone(packageData.state);
  assert(state && state.schema_version === SCHEMA && state.imported === true, 'Archivio non valido.');
  assert(state.documents && DOCUMENTS.every(key => own(state.documents, key)), 'Mancano i documenti originali nell’archivio.');
  validateStoredPlan(state.documents['piano_settimanale.json']);
  assert(Array.isArray(state.documents['catalogo_alimenti.json'].foods), 'Catalogo mancante.');
  for (const field of ['plans', 'user_foods', 'shopping', 'pantry', 'consumption', 'consumption_log', 'movements', 'accesses', 'recurrence_versions']) assert(Array.isArray(state[field]) && state[field].length <= 100000, 'Archivio non valido: ' + field);
  for (const food of [...state.documents['catalogo_alimenti.json'].foods, ...state.user_foods]) {
    text(food.food_id, 'Codice alimento', 3000);
    text(food.display_name, 'Nome alimento', 1200);
    assert(Array.isArray(food.units_seen) && food.units_seen.every(u => typeof u === 'string' || u === null), 'Unità del catalogo non valide.');
  }
  const available = new Set(catalog(state).map(f => f.food_id));
  const knownItem = item => {
    validateItem(item, true);
    assert(available.has(item.food_id), 'Alimento sconosciuto nei dati operativi.');
  };
  for (const plan of state.plans) {
    assert(Number.isInteger(plan.id) && plan.id > 0, 'Identificatore piano non valido.');
    iso(plan.valid_from);
    validateStoredPlan(plan.content);
    if (plan.pdf_base64) validatePdf(plan.pdf_base64);
  }
  unique(state.plans, p => p.id, 'Versioni duplicate.');
  unique(state.plans, p => p.valid_from, 'Date dei piani duplicate.');
  const substitutions = state.documents['sostituzioni.json'].rules;
  assert(Array.isArray(substitutions) && substitutions.length <= 200, 'Regole non valide.');
  for (const rule of substitutions) {
    text(rule.rule_id);
    text(rule.matching_policy);
    assert(Array.isArray(rule.source_items) && rule.source_items.length <= 20 && Array.isArray(rule.alternatives) && rule.alternatives.length <= 100 && Array.isArray(rule.notes), 'Regola di sostituzione non valida.');
    rule.source_items.forEach(x => validateItem(x));
    for (const option of rule.alternatives) {
      text(option.option_id);
      text(option.label, 'Alternativa', 1200);
      assert(Array.isArray(option.items) && Array.isArray(option.notes) && Array.isArray(option.limits) && ['ready', 'select_quantity', 'select_food'].includes(option.status), 'Alternativa non valida.');
      option.items.forEach(x => validateItem(x));
    }
  }
  const guidance = state.documents['regole_e_indicazioni.json'];
  assert(Array.isArray(guidance.rules) && Array.isArray(guidance.weekly_limits), 'Indicazioni mancanti.');
  for (const item of state.pantry) knownItem(item);
  unique(state.pantry, pair, 'Scorte duplicate.');
  for (const record of state.consumption) {
    iso(record.day);
    assert(typeof record.processed === 'boolean' && Array.isArray(record.items), 'Consumo non valido.');
    record.items.forEach(knownItem);
    unique(record.items, pair, 'Alimenti duplicati nel consumo.');
  }
  unique(state.consumption, r => r.day, 'Date consumo duplicate.');
  for (const entry of state.recurrence_versions) {
    text(entry.plan_id);
    iso(entry.valid_from);
    assert(Number.isInteger(entry.weekday) && entry.weekday >= 1 && entry.weekday <= 7 && Array.isArray(entry.items), 'Ricorrenza non valida.');
    entry.items.forEach(knownItem);
  }
  unique(state.recurrence_versions, r => JSON.stringify([r.plan_id, r.weekday, r.valid_from]), 'Ricorrenze duplicate.');
  for (const list of state.shopping) {
    assert(Number.isInteger(list.id) && list.id > 0 && ['open', 'completed'].includes(list.status) && Array.isArray(list.rows) && Array.isArray(list.covered) && Array.isArray(list.issues) && !list.issues.length, 'Lista non valida.');
    iso(list.start);
    iso(list.end);
    assert(list.end >= list.start, 'Periodo della lista non valido.');
    for (const row of [...list.rows, ...list.covered]) {
      knownItem(row);
      for (const field of ['required', 'available', 'to_buy', 'purchased']) number(row[field]);
      assert(typeof row.checked === 'boolean' && typeof row.id === 'string', 'Riga della spesa non valida.');
    }
    unique(list.rows, r => r.id, 'Righe duplicate nella lista.');
    for (const schedule of [list.schedule, list.recurring_schedule].filter(Boolean)) {
      assert(typeof schedule === 'object' && !Array.isArray(schedule), 'Programma consumi non valido.');
      for (const [day, items] of Object.entries(schedule)) {
        iso(day);
        assert(Array.isArray(items), 'Programma consumi non valido.');
        items.forEach(knownItem);
      }
    }
  }
  assert(state.shopping.filter(s => s.status === 'open').length <= 1, 'Il backup contiene più liste aperte.');
  unique(state.shopping, s => s.id, 'Liste duplicate.');
  for (const entry of state.consumption_log) {
    iso(entry.day);
    number(entry.needed);
    number(entry.used);
    assert(entry.used <= entry.needed && available.has(entry.food_id) && typeof entry.unit === 'string', 'Registro dei consumi non valido.');
  }
  unique(state.consumption_log, r => JSON.stringify([r.day, r.food_id, r.unit]), 'Registri di consumo duplicati.');
  for (const entry of state.movements) {
    assert(Number.isInteger(entry.id) && entry.id > 0 && available.has(entry.food_id) && typeof entry.unit === 'string', 'Movimento non valido.');
    iso(entry.day);
    number(entry.quantity, true);
    text(entry.reason);
  }
  unique(state.movements, m => m.id, 'Movimenti duplicati.');
  for (const entry of state.accesses) {
    text(entry.token, 'Accesso', 100);
    assert(typeof entry.accessed === 'string' && Number.isFinite(Date.parse(entry.accessed)) && Number.isInteger(entry.movement_id) && entry.movement_id >= 0 && Array.isArray(entry.report?.items) && Array.isArray(entry.report?.details), 'Storico accessi non valido.');
  }
  unique(state.accesses, a => a.token, 'Accessi duplicati.');
  return state;
}
export function makeBackup(state, now) {
  return {
    kind: 'ricettario-iphone-backup',
    version: SCHEMA,
    exported_at: now,
    state: clone(state)
  };
}
