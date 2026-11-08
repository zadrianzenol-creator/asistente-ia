document.getElementById('wipe').addEventListener('click', function () {
  if (!confirm('¿Borrar todo el historial y los ajustes guardados en este dispositivo?')) return;
  try {
    ['asistente.v1', 'asistente.draft', 'theme'].forEach(function (k) { localStorage.removeItem(k); });
    if (window.indexedDB) indexedDB.deleteDatabase('asistente-img');
    document.getElementById('wipeMsg').textContent = 'Listo: se borraron los datos locales de este dispositivo.';
  } catch (e) {
    document.getElementById('wipeMsg').textContent = 'No se pudo acceder al almacenamiento local.';
  }
});
