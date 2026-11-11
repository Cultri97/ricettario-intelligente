/** Spesa, dispensa e riepilogo accessi. Richiede app.js; Gestisci piano richiama loadPlanManager da plans.js. */
'use strict';
const post = (url, data) => api(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(data)
});
const displayDate = value => new Intl.DateTimeFormat('it-IT').format(new Date(value + 'T12:00:00'));
const qtyText = (value, unit) => new Intl.NumberFormat('it-IT', {
  maximumFractionDigits: 3
}).format(value) + ' ' + unit;
let selections = {},
  exactQuantities = {},
  replacements = {},
  personalized = false;
for (const section of ['plan', 'shopping', 'pantry', 'manage']) {
  $('tab-' + section).onclick = async () => {
    for (const id of ['plan', 'shopping', 'pantry', 'manage']) {
      $(id === 'plan' ? 'planner' : id).hidden = id !== section;
      $('tab-' + id).classList.toggle('active', id === section);
      $('tab-' + id).setAttribute('aria-pressed', String(id === section));
    }
    try {
      if (section === 'manage') await loadPlanManager();
      if (section === 'shopping') await loadLists();
      if (section === 'pantry') await loadPantry();
    } catch (e) {
      fail(e);
    }
  };
}
const monday = new Date();
monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
const sunday = new Date(monday);
sunday.setDate(sunday.getDate() + 6);
$('shop-start').value = localDate(monday);
$('shop-end').value = localDate(sunday);

function shopData() {
  return {
    start: $('shop-start').value,
    end: $('shop-end').value,
    exclude_outside: $('exclude-outside').checked,
    selections,
    quantities: exactQuantities,
    replacements,
    personalize: personalized
  };
}
for (const id of ['shop-start', 'shop-end', 'exclude-outside']) $(id).onchange = () => {
  selections = {};
  exactQuantities = {};
  resetCustomization();
  $('resolutions').replaceChildren();
};

function showIssues(issues) {
  const box = $('resolutions');
  box.replaceChildren();
  if (!issues.length) return;
  box.append(node('h3', 'Completa le scelte del piano'), node('p', 'Queste scelte valgono per questa lista. Il piano originale non cambia.'));
  for (const issue of issues) {
    const label = node('label', issue.label + ' ', 'resolution');
    let input;
    if (issue.kind === 'choice') {
      input = node('select');
      const placeholder = node('option', 'Scegli un’alternativa');
      placeholder.value = '';
      input.append(placeholder);
      for (const option of issue.options) {
        const o = node('option', option.label);
        o.value = option.id;
        input.append(o);
      }
      input.value = selections[issue.key] || '';
      input.onchange = () => {
        selections[issue.key] = input.value;
      };
    } else {
      input = node('input');
      input.type = 'number';
      input.step = 'any';
      input.min = issue.range?.min || '0.001';
      if (issue.range) input.max = issue.range.max;
      input.value = exactQuantities[issue.key] ?? '';
      input.placeholder = issue.range ? `${issue.range.min}–${issue.range.max} ${issue.unit}` : `Quantità in ${issue.unit}`;
      input.oninput = () => {
        if (input.value) exactQuantities[issue.key] = input.value;
        else delete exactQuantities[issue.key];
      };
    }
    label.append(input);
    box.append(label);
  }
  box.append(node('p', 'Poi premi di nuovo “Crea lista della spesa”.', 'muted'));
}
$('shopping-form').onsubmit = async e => {
  e.preventDefault();
  const b = e.submitter;
  b.disabled = true;
  try {
    const result = await post('/api/shopping/create', shopData());
    showIssues(result.issues);
    $('shopping-status').textContent = result.issues.length ? 'Servono alcune scelte prima di creare la lista.' : 'Lista creata e salvata sul dispositivo.';
    if (!result.issues.length) await loadLists();
    $('error').hidden = true;
  } catch (e) {
    fail(e);
  } finally {
    b.disabled = false;
  }
};
async function loadLists() {
  const lists = (await api('/api/lists')).filter(list => list.status === 'open');
  const root = $('shopping-lists');
  root.replaceChildren();
  const hasOpen = lists.some(list => list.status === 'open');
  $('shopping-form').hidden = hasOpen;
  if (hasOpen) $('shopping-customization').hidden = true;
  if (hasOpen) {
    $('resolutions').replaceChildren();
    root.append(node('p', 'Hai una lista aperta. Completala oppure eliminala prima di crearne un’altra.', 'muted'));
  }
  if (!lists.length) root.append(node('p', 'Non hai liste aperte. Puoi creare una nuova spesa.'));
  for (const list of lists) {
    const card = node('article', undefined, 'panel shopping-list');
    card.append(node('h3', displayDate(list.start) + ' – ' + displayDate(list.end)), node('p', list.status === 'completed' ? 'Spesa completata · acquisti trasferiti in dispensa' : 'Da completare · lista salvata', 'muted'));
    const remove = node('button', 'Elimina lista', 'delete-shopping');
    remove.type = 'button';
    remove.onclick = async () => {
      remove.disabled = true;
      try {
        await post('/api/shopping/delete', {
          id: list.id
        });
        await loadLists();
        $('resolutions').replaceChildren();
        $('shopping-status').textContent = 'Lista eliminata. Puoi creare una nuova spesa.';
        $('error').hidden = true;
      } catch (error) {
        fail(error);
        remove.disabled = false;
      }
    };
    card.append(remove);
    if (list.personalization_labels?.length) {
      const chosen = node('details');
      chosen.append(node('summary', 'Sostituzioni scelte'));
      for (const text of list.personalization_labels) chosen.append(node('p', text));
      card.append(chosen);
    }
    const controls = [];
    if (list.status === 'open' && list.rows.length) {
      const checkAll = node('button', 'Spunta tutti');
      checkAll.type = 'button';
      checkAll.onclick = async () => {
        checkAll.disabled = true;
        const values = controls.map(({
          row,
          check,
          amount
        }) => ({
          id: list.id,
          row_id: row.id,
          checked: true,
          purchased: amount.value
        }));
        for (const {
            check,
            amount
          }
          of controls) {
          check.disabled = true;
          amount.disabled = true;
        }
        try {
          for (const value of values) await post('/api/shopping/update', value);
          $('error').hidden = true;
          $('shopping-status').textContent = 'Tutti gli articoli sono spuntati. Puoi completare la spesa.';
        } catch (e) {
          fail(e);
        } finally {
          await loadLists();
        }
      };
      card.append(checkAll);
    }
    for (const row of list.rows) {
      const line = node('div', undefined, 'shopping-row');
      const label = node('label');
      const check = node('input');
      check.type = 'checkbox';
      check.checked = row.checked;
      check.disabled = list.status === 'completed';
      label.append(check, node('span', row.name));
      const amount = node('input');
      amount.type = 'number';
      amount.min = '0.001';
      amount.step = 'any';
      amount.value = row.purchased;
      amount.disabled = check.disabled;
      amount.setAttribute('aria-label', 'Quantità acquistata: ' + row.name);
      controls.push({
        row,
        check,
        amount
      });
      const save = async () => {
        check.disabled = true;
        amount.disabled = true;
        try {
          await post('/api/shopping/update', {
            id: list.id,
            row_id: row.id,
            checked: check.checked,
            purchased: amount.value
          });
          row.checked = check.checked;
          row.purchased = Number(amount.value);
          $('error').hidden = true;
        } catch (e) {
          check.checked = row.checked;
          amount.value = row.purchased;
          fail(e);
        } finally {
          check.disabled = false;
          amount.disabled = false;
        }
      };
      check.onchange = save;
      amount.onchange = save;
      const info = node('small', `Piano: ${qtyText(row.required,row.unit)} · Già in dispensa: ${qtyText(row.available,row.unit)} · Da comprare: ${qtyText(row.to_buy,row.unit)}`, 'muted');
      line.append(label, amount, node('span', row.unit), info);
      card.append(line);
    }
    if (list.covered.length) {
      const covered = node('details');
      covered.append(node('summary', `Già coperti dalla dispensa (${list.covered.length})`));
      for (const row of list.covered) covered.append(node('p', row.name + ' · ' + qtyText(row.required, row.unit) + ' previsti / ' + qtyText(row.available, row.unit) + ' presenti'));
      card.append(covered);
    }
    if (list.status === 'open') {
      const finish = node('button', 'Completa spesa e aggiorna dispensa');
      finish.onclick = async () => {
        finish.disabled = true;
        try {
          await post('/api/shopping/complete', {
            id: list.id
          });
          await loadLists();
          $('shopping-status').textContent = 'Acquisti trasferiti in dispensa. I consumi futuri del periodo sono programmati.';
        } catch (e) {
          fail(e);
          finish.disabled = false;
        }
      };
      card.append(finish, node('p', 'La lista usa le scorte presenti al momento della creazione. Le quantità della lista restano quelle calcolate alla creazione.', 'muted'));
    }
    root.append(card);
  }
}
async function loadPantry() {
  const data = await api('/api/pantry');
  const root = $('pantry-items');
  root.replaceChildren();
  if (!data.items.length) root.append(node('p', 'La dispensa è vuota. Aggiungi le scorte che hai già, oppure completa una spesa.'));
  for (const item of data.items) {
    const row = node('form', undefined, 'pantry-row pantry-edit');
    const label = node('label', item.name, 'pantry-name');
    const input = node('input');
    input.type = 'number';
    input.min = '0';
    input.step = 'any';
    input.required = true;
    input.value = item.quantity;
    input.setAttribute('aria-label', 'Quantità rimasta: ' + item.name + ' (' + item.unit + ')');
    label.append(input);
    const save = node('button', 'Salva');
    save.type = 'submit';
    save.setAttribute('aria-label', 'Salva quantità di ' + item.name);
    const status = node('small', undefined, 'muted pantry-save-status');
    status.setAttribute('role', 'status');
    row.append(label, node('span', item.unit), save, status);
    row.onsubmit = async event => {
      event.preventDefault();
      save.disabled = true;
      try {
        await post('/api/pantry/set', {
          food_id: item.food_id,
          unit: item.unit,
          quantity: input.value
        });
        item.quantity = Number(input.value);
        status.textContent = 'Quantità salvata';
        $('error').hidden = true;
      } catch (error) {
        status.textContent = 'Quantità non salvata';
        fail(error);
      } finally {
        save.disabled = false;
      }
    };
    input.oninput = () => {
      status.textContent = 'Modifica da salvare';
    };
    root.append(row);
  }
  $('pantry-notes').replaceChildren();
  if (data.shortages.length) {
    $('pantry-notes').append(node('h3', 'Scorte insufficienti nei giorni trascorsi'), node('p', 'Il consumo previsto superava le scorte: abbiamo fermato il residuo a zero. Verifica le quantità presenti.'));
    for (const shortage of data.shortages) $('pantry-notes').append(node('p', displayDate(shortage.date) + ' · ' + shortage.food + ' · mancavano ' + qtyText(shortage.missing, shortage.unit)));
  }
}
$('pantry-form').onsubmit = async e => {
  e.preventDefault();
  const b = e.submitter;
  b.disabled = true;
  try {
    await post('/api/pantry/set', {
      food_id: $('pantry-food').value,
      unit: $('pantry-unit').value,
      quantity: $('pantry-quantity').value
    });
    await loadPantry();
    $('error').hidden = true;
  } catch (e) {
    fail(e);
  } finally {
    b.disabled = false;
  }
};
(async () => {
  try {
    if (!await window.RicettarioReady) return;
    const catalog = await api('/api/catalog');
    for (const food of catalog) {
      const option = node('option', food.display_name || food.food_id);
      option.value = food.food_id;
      option.dataset.unit = food.units_seen[0];
      $('pantry-food').append(option);
    }
    $('pantry-food').onchange = () => {
      $('pantry-unit').value = $('pantry-food').selectedOptions[0].dataset.unit;
    };
    $('pantry-food').onchange();
    await loadAccessSummary();
  } catch (e) {
    fail(e);
  }
})();

function resetCustomization() {
  personalized = false;
  replacements = {};
  for (const key of Object.keys(exactQuantities))
    if (key.includes('/sub/')) delete exactQuantities[key];
  $('shopping-customization').hidden = true;
  $('customization-options').replaceChildren();
}
$('reset-customization').onclick = () => {
  resetCustomization();
  $('resolutions').replaceChildren();
  $('shopping-status').textContent = 'Useremo il piano originale.';
};
$('customize-shopping').onclick = async () => {
  const button = $('customize-shopping');
  button.disabled = true;
  personalized = true;
  try {
    const result = await post('/api/shopping/preview', shopData());
    showIssues(result.issues);
    const root = $('customization-options');
    root.replaceChildren();
    $('shopping-customization').hidden = false;
    if (!result.customization.length) root.append(node('p', 'Non ci sono sostituzioni disponibili per i pasti selezionati.'));
    for (const slot of result.customization) {
      const detail = node('details', undefined, 'customization-slot');
      detail.append(node('summary', displayDate(slot.meal.slice(0, 10)) + ' · ' + slot.meal.slice(13) + ' · ' + slot.label));
      const label = node('label', 'Scegli per questo pasto: ', 'resolution');
      const select = node('select');
      const original = node('option', 'Mantieni il piano originale');
      original.value = '';
      select.append(original);
      for (const option of slot.options) {
        const el = node('option', option.label);
        el.value = option.id;
        el.disabled = option.disabled;
        select.append(el);
      }
      select.value = replacements[slot.key] || '';
      const notes = node('div');
      const update = () => {
        replacements[slot.key] = select.value;
        notes.replaceChildren();
        const option = slot.options.find(o => o.id === select.value);
        if (option)
          for (const text of option.notes) notes.append(node('p', text, 'note'));
      };
      select.onchange = update;
      update();
      label.append(select);
      detail.append(label, notes);
      root.append(detail);
    }
    $('shopping-status').textContent = 'Sostituzioni facoltative. Scegli quelle desiderate, poi premi Crea lista della spesa. Se cambi le alternative del piano, riapri questa personalizzazione.';
    $('error').hidden = true;
  } catch (e) {
    fail(e);
  } finally {
    button.disabled = false;
  }
};

async function loadAccessSummary() {
  const key = 'ricettario-iphone-access';
  let session;
  try {
    session = JSON.parse(sessionStorage.getItem(key) || 'null');
  } catch (e) {
    session = null;
  }
  if (!session || session.day !== today()) {
    session = {
      day: today(),
      token: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : String(Date.now()) + '-' + Math.random()
    };
    sessionStorage.setItem(key, JSON.stringify(session));
  }
  const report = await post('/api/access', {
    token: session.token
  });
  const root = $('access-summary');
  root.replaceChildren(node('h3', 'Dall’ultimo accesso'));
  const format = value => new Intl.DateTimeFormat('it-IT', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Europe/Rome'
  }).format(new Date(value));
  root.append(node('p', report.previous_access ? 'Accesso precedente: ' + format(report.previous_access) : 'Primo accesso registrato: ' + format(report.accessed), 'muted'));
  root.append(node('p', 'Accesso attuale: ' + format(report.accessed), 'muted'));
  if (!report.items.length) root.append(node('p', report.previous_access ? 'Nessun alimento è stato tolto dalla dispensa dall’ultimo accesso.' : 'Da questo accesso registreremo le quantità tolte dalla dispensa.'));
  else {
    const list = node('ul');
    for (const item of report.items) {
      const row = node('li');
      row.append(node('span', item.name), node('strong', '− ' + qtyText(item.quantity, item.unit)));
      list.append(row);
    }
    root.append(list);
    const details = node('details');
    details.append(node('summary', 'Vedi dettaglio per giorno'));
    for (const item of report.details) details.append(node('p', displayDate(item.date) + ' · ' + item.name + ' · − ' + qtyText(item.quantity, item.unit) + ' · ' + item.reason));
    root.append(details);
  }
  root.append(node('p', 'Sono indicate le quantità effettivamente sottratte, inclusi i consumi automatici e le riduzioni manuali. Il riepilogo resta uguale durante questo accesso.', 'muted'));
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    try {
      const session = JSON.parse(sessionStorage.getItem('ricettario-iphone-access') || 'null');
      if (session && session.day !== today()) loadAccessSummary().catch(fail);
    } catch (e) {
      fail(e);
    }
  }
});
