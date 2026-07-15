import { loadAll } from './api.js';
import { toast } from './ui.js';
import { renderTrips } from './trips.js';
import { renderExpenses } from './expenses.js';
import { renderLoyalty } from './loyalty.js';
import { renderRegistries } from './registries.js';
import { renderSettings } from './settings.js';

const TABS = {
  trips: renderTrips,
  expenses: renderExpenses,
  loyalty: renderLoyalty,
  registries: renderRegistries,
  settings: renderSettings
};

let active = 'trips';

export async function refresh() {
  const view = document.getElementById('view');
  try {
    const data = await loadAll();
    view.replaceChildren();
    TABS[active](view, data, refresh);
  } catch (err) {
    toast(err.message, true);
  }
}

document.getElementById('tabs').addEventListener('click', (ev) => {
  const button = ev.target.closest('button[data-tab]');
  if (!button) return;
  active = button.dataset.tab;
  for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('active', b === button);
  refresh();
});

refresh();
