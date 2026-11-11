/** Archivio IndexedDB transazionale. Le API locali non inviano dati in rete. */
'use strict';
window.RicettarioReady = (async () => {
  const core = await import('./core.mjs');
  const storageName = 'ricettario-iphone:' + new URL('./', location.href).pathname;
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open(storageName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('archive');
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(new Error('Non è possibile aprire l’archivio sul dispositivo. Evita la navigazione privata.'));
    request.onblocked = () => reject(new Error('Chiudi le altre schede del Ricettario e riprova.'));
  });
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  };
  const clock = () => ({
    today: today(),
    now: new Date().toISOString()
  });
  const transact = (operation, mode = 'readwrite') => new Promise((resolve, reject) => {
    const transaction = database.transaction('archive', mode);
    const store = transaction.objectStore('archive');
    let result, error;
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(error || new Error('Salvataggio non riuscito. Verifica lo spazio libero sull’iPhone.'));
    transaction.onabort = () => reject(error || new Error('Salvataggio annullato. I dati precedenti restano invariati.'));
    const request = store.get('state');
    request.onsuccess = () => {
      try {
        const output = operation(request.result || core.newState());
        result = output.result;
        if (mode === 'readwrite') store.put(output.state, 'state');
      } catch (e) {
        error = e;
        transaction.abort();
      }
    };
  });
  window.LocalAPI = {
    ready: true,
    async hasData() {
      return transact(s => ({
        result: s.imported
      }), 'readonly');
    },
    async request(url, options = {}) {
      let data = {};
      if (options.body) {
        try {
          data = JSON.parse(options.body);
        } catch {
          throw new Error('Richiesta non valida.');
        }
      }
      return transact(s => core.execute(s, options.method || 'GET', url, data, clock()));
    },
    async snapshot() {
      return transact(s => ({
        result: core.makeBackup(s, new Date().toISOString())
      }), 'readonly');
    },
    async replace(packageData) {
      const state = core.validateBackup(packageData);
      await transact(() => ({
        state,
        result: true
      }));
    },
    async backup() {
      const time = new Date().toISOString();
      return transact(s => {
        if (!s.imported) throw new Error('Importa prima i tuoi dati.');
        s.last_backup_at = time;
        return {
          state: s,
          result: core.makeBackup(s, time)
        };
      });
    },
    async pdfURL(id) {
      const value = await transact(s => ({
        result: s.plans.find(p => p.id === id)?.pdf_base64
      }), 'readonly');
      if (!value) throw new Error('PDF non disponibile.');
      const raw = atob(value);
      return URL.createObjectURL(new Blob([Uint8Array.from(raw, c => c.charCodeAt(0))], {
        type: 'application/pdf'
      }));
    },
    async backupDate() {
      return transact(s => ({
        result: s.last_backup_at
      }), 'readonly');
    }
  };
  return LocalAPI.hasData();
})();
window.RicettarioReady.catch(error => {
  document.addEventListener('DOMContentLoaded', () => {
    const e = document.getElementById('startup-error');
    if (e) e.textContent = error.message;
  }, {
    once: true
  });
});
