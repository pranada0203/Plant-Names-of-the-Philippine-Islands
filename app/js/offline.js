/**
 * Registering the service worker, and telling the reader when a new edition
 * of the dictionary has arrived.
 *
 * The update is never applied underneath someone. A service worker that calls
 * `skipWaiting()` on its own swaps the data out mid-session: a reader who has
 * scrolled to ABACÁ and opened the scan gets a different payload on their next
 * click, with different ids behind the same URLs. So the new worker waits, the
 * page says so, and the reader decides when.
 */

const el = (id) => document.getElementById(id);

// Reload only when the reader asked for it. `controllerchange` also fires the
// first time a worker claims an uncontrolled page -- that is, on someone's
// first visit, where reloading would be a pointless flash at best and a loop
// at worst. Gating on an explicit click is the one rule that cannot misfire.
let accepted = false;

/** Show the bar and wire its two buttons. */
function offerUpdate(worker) {
  const bar = el('update');
  if (!bar) return;
  bar.hidden = false;

  el('update-reload').onclick = () => {
    bar.hidden = true;
    accepted = true;
    // The worker takes over, which fires `controllerchange` below.
    worker.postMessage('skip-waiting');
  };
  el('update-dismiss').onclick = () => {
    bar.hidden = true;
    // Nothing is cancelled: the new worker still activates on the next visit,
    // when swapping the data under the reader costs nothing.
  };
}

export function initOffline() {
  if (!('serviceWorker' in navigator)) return;
  // file:// has no origin a worker can be scoped to, and registering from one
  // throws rather than failing quietly.
  if (!location.protocol.startsWith('http')) return;

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!accepted || reloading) return;
    reloading = true;
    location.reload();
  });

  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('sw.js');

      // Already waiting when the page loaded: a previous visit downloaded it.
      if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);

      reg.addEventListener('updatefound', () => {
        const next = reg.installing;
        if (!next) return;
        next.addEventListener('statechange', () => {
          // `controller` is null on the very first visit, when there is nothing
          // to update *from* and the worker should just take over silently.
          if (next.state === 'installed' && navigator.serviceWorker.controller) {
            offerUpdate(next);
          }
        });
      });
    } catch {
      // No offline support, then. The app works; it just needs the network.
    }
  });
}
