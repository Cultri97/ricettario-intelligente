/** Installazione, backup ed aggiornamenti. Nessun dato personale esce dal dispositivo. */
'use strict';
(() => {
  const get = id => document.getElementById(id);
  let registration;

  function message(text) {
    const target = get('backup-status');
    if (target) target.textContent = text;
  }
  async function importFile(input) {
    const file = input.files[0];
    if (!file) return;
    try {
      if (file.size > 80 * 1024 * 1024) throw new Error('Archivio troppo grande: il limite è 80 MB.');
      await window.RicettarioReady;
      const packageData = JSON.parse(await file.text());
      const core = await import('./core.mjs');
      core.validateBackup(packageData);
      if (await LocalAPI.hasData() && !window.confirm('L’importazione sostituisce tutti i dati su questo dispositivo. Hai esportato un backup di quelli attuali?')) return;
      await LocalAPI.replace(packageData);
      sessionStorage.removeItem('ricettario-iphone-access');
      localStorage.removeItem('ricettario-iphone-plan-draft');
      try {
        if (navigator.storage?.persist) await navigator.storage.persist();
      } catch {}
      location.reload();
    } catch (error) {
      get('startup-error').textContent = 'Importazione non riuscita: ' + error.message;
      message('Importazione non riuscita: ' + error.message + ' I dati precedenti sono stati conservati.');
    } finally {
      input.value = '';
    }
  }
  get('first-import').onchange = () => importFile(get('first-import'));
  get('restore-backup').onchange = () => importFile(get('restore-backup'));
  get('export-backup').onclick = async () => {
    const button = get('export-backup');
    button.disabled = true;
    try {
      const backup = await LocalAPI.backup();
      const blob = new Blob([JSON.stringify(backup)], {
        type: 'application/json'
      });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.href = url;
      link.download = 'Ricettario-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      message('Backup preparato. Conserva il file in File o iCloud Drive; verifica che il download sia completato. Contiene i tuoi dati personali.');
    } catch (error) {
      message(error.message);
    } finally {
      button.disabled = false;
    }
  };
  get('install-help').onclick = () => {
    get('install-instructions').hidden = !get('install-instructions').hidden;
  };

  function connection() {
    get('offline-status').textContent = navigator.onLine ? 'Dati locali · connessione disponibile' : 'Offline · puoi continuare a usare l’app';
  }
  connection();
  window.addEventListener('online', connection);
  window.addEventListener('offline', connection);
  get('apply-update').onclick = () => {
    if (!registration?.waiting) return;
    if (!window.confirm('Ricaricare l’app? Salva prima le quantità modificate. La bozza del piano rimane conservata.')) return;
    registration.waiting.postMessage({
      type: 'SKIP_WAITING'
    });
  };
  if ('serviceWorker' in navigator && window.isSecureContext) {
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!reloading) {
        reloading = true;
        location.reload();
      }
    });
    navigator.serviceWorker.register('./sw.js', {
      scope: './'
    }).then(value => {
      registration = value;
      const showUpdate = () => {
        if (value.waiting) get('update-notice').hidden = false;
      };
      showUpdate();
      value.addEventListener('updatefound', () => {
        const worker = value.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdate();
        });
      });
      return navigator.serviceWorker.ready;
    }).then(() => {
      const status = get('offline-ready');
      if (status) status.textContent = 'App pronta per l’uso offline.';
    }).catch(() => {
      const status = get('offline-ready');
      if (status) status.textContent = 'Preparazione offline non riuscita. Ricarica quando sei connesso.';
    });
  }
  window.RicettarioReady.then(async hasData => {
    if (!hasData) return;
    const date = await LocalAPI.backupDate();
    message(date ? 'Ultimo backup preparato: ' + new Intl.DateTimeFormat('it-IT', {
      dateStyle: 'short',
      timeStyle: 'short'
    }).format(new Date(date)) + '. Conserva una copia fuori dall’app.' : 'Non hai ancora esportato un backup. Ti consigliamo di farlo dopo ogni spesa completata.');
  }).catch(error => {
    get('startup-error').textContent = error.message;
  });
})();
