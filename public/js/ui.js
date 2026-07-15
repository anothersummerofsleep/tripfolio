// Small DOM helpers — no framework, on purpose.

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (value !== undefined && value !== null && value !== false) node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(child));
  }
  return node;
}

export function toast(message, isError = false) {
  const node = document.getElementById('toast');
  node.textContent = message;
  node.classList.toggle('error', isError);
  node.hidden = false;
  clearTimeout(node._timer);
  node._timer = setTimeout(() => { node.hidden = true; }, 3500);
}

export function dateLabel(iso) {
  if (!iso) return '—';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
}

// "2026-09-14T09:25" → "14 Sep, 09:25" (local wall-clock time, no zone math).
export function dtLabel(v) {
  if (!v) return '—';
  const [date, time] = v.split('T');
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return v;
  const day = d.toLocaleDateString('en-SG', { day: 'numeric', month: 'short' });
  return time ? `${day}, ${time}` : day;
}

export function daysUntil(iso) {
  if (!iso) return null;
  return Math.round((new Date(`${iso}T00:00:00`) - new Date().setHours(0, 0, 0, 0)) / 86400000);
}

export function confirmDelete(label) {
  return window.confirm(`Delete ${label}? This cannot be undone.`);
}
