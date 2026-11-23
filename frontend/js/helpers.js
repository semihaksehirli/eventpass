// Helpers used by every logged-in page (student pages and both dashboards).

// All table data, loaded from api.js
const db = { Users: [], Venues: [], Categories: [], Events: [], TicketTypes: [], Bookings: [], BookingItems: [], Payments: [], Tickets: [] };

// ---------- Helpers ----------

function esc(text) {
  const div = document.createElement("div");
  div.textContent = text == null ? "" : String(text);
  return div.innerHTML;
}

function money(n) { return Number(n) === 0 ? "Free" : "$" + Number(n).toFixed(2); }

function fmtDate(d) {
  if (!d) return "";
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtTime(t) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  return ((h % 12) || 12) + ":" + String(m).padStart(2, "0") + (h < 12 ? " AM" : " PM");
}

function today() { return todayISO(); }

function find(table, id) {
  const key = TABLE_KEYS[table];
  return db[table].find(r => r[key] === id);
}

function fullName(user) { return user ? user.FirstName + " " + user.LastName : "Unknown"; }

function badge(text) {
  return `<span class="badge badge-${String(text).toLowerCase()}">${esc(text === "Customer" ? "Student" : text)}</span>`;
}

function toast(text) {
  const el = document.getElementById("toast");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2500);
}

function ticketsForEvent(eventId) { return db.TicketTypes.filter(t => t.EventID === eventId); }

function soldForEvent(eventId) {
  return ticketsForEvent(eventId).reduce((sum, t) => sum + (t.QuantityTotal - t.QuantityAvailable), 0);
}

function capacityForEvent(eventId) {
  return ticketsForEvent(eventId).reduce((sum, t) => sum + t.QuantityTotal, 0);
}

function priceRange(eventId) {
  const prices = ticketsForEvent(eventId).map(t => t.Price);
  if (!prices.length) return "—";
  const lo = Math.min(...prices), hi = Math.max(...prices);
  return lo === hi ? money(lo) : money(lo) + " – " + money(hi);
}

function itemsForBooking(bookingId) { return db.BookingItems.filter(i => i.BookingID === bookingId); }

function eventsForBooking(bookingId) {
  const titles = itemsForBooking(bookingId).map(i => {
    const tt = find("TicketTypes", i.TicketTypeID);
    const ev = tt && find("Events", tt.EventID);
    return ev ? ev.Title : "Deleted event";
  });
  return [...new Set(titles)];
}

function bookingTicketCount(bookingId) {
  return itemsForBooking(bookingId).reduce((sum, i) => sum + i.Quantity, 0);
}

async function loadAll() {
  if (!USE_MOCK) {
    Object.assign(db, await request("GET", "/student"));
    return;
  }
  for (const table of Object.keys(db)) db[table] = await getAll(table);
}

// ---------- Event photos ----------

const CATEGORY_COLORS = ["#f47b20", "#111111", "#c2410c", "#404040", "#ea580c", "#262626"];

// Default banner (an SVG picture) for events with no uploaded photo
function defaultEventImage(ev) {
  const cat = find("Categories", ev.CategoryID);
  const name = cat ? cat.Name : "Event";
  const color = CATEGORY_COLORS[(ev.CategoryID || 0) % CATEGORY_COLORS.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="#111111"/></linearGradient></defs>
    <rect width="800" height="450" fill="url(#g)"/>
    <text x="400" y="240" font-family="Arial" font-size="44" font-weight="bold" fill="#ffffff" text-anchor="middle">${esc(name)}</text></svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

function eventImage(ev) { return ev.ImageURL || defaultEventImage(ev); }

// Shrinks an uploaded photo to max 800px wide so it fits in browser storage
function readImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve(null);
    if (!file.type.startsWith("image/")) return reject(new Error("Please choose an image file."));
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 800 / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.75));
      };
      img.onerror = () => reject(new Error("That image couldn't be opened."));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error("That image couldn't be read."));
    reader.readAsDataURL(file);
  });
}


// ---------- More event & booking helpers ----------

function isPast(ev) { return ev.EventDate < today(); }

// Students can only see and book approved, upcoming events
function isBookable(ev) { return ev && ev.Status === "Active" && !isPast(ev); }

function minPrice(eventId) {
  const prices = ticketsForEvent(eventId).map(t => t.Price);
  return prices.length ? Math.min(...prices) : 0;
}

function seatsLeft(eventId) {
  return ticketsForEvent(eventId).reduce((sum, t) => sum + t.QuantityAvailable, 0);
}

function ticketsForItem(itemId) { return db.Tickets.filter(t => t.BookingItemID === itemId); }

function paymentForBooking(bookingId) { return db.Payments.find(p => p.BookingID === bookingId); }

// The (first) event a booking is for — used to sort bookings into upcoming / past
function bookingEvents(bookingId) {
  const ids = [...new Set(itemsForBooking(bookingId).map(i => (find("TicketTypes", i.TicketTypeID) || {}).EventID))];
  return ids.map(id => find("Events", id)).filter(Boolean)
    .sort((a, b) => (a.EventDate + a.StartTime).localeCompare(b.EventDate + b.StartTime));
}

// Sales & attendance numbers for one event (confirmed bookings only)
function eventSales(eventId) {
  const typeIds = new Set(ticketsForEvent(eventId).map(t => t.TicketTypeID));
  const lines = db.BookingItems.filter(i => typeIds.has(i.TicketTypeID) &&
    (find("Bookings", i.BookingID) || {}).Status === "Confirmed");
  const sold = lines.reduce((s, i) => s + i.Quantity, 0);
  const revenue = lines.reduce((s, i) => s + i.Quantity * i.UnitPrice, 0);
  const checkedIn = lines.reduce((s, i) => s + ticketsForItem(i.BookingItemID).filter(t => t.IsCheckedIn).length, 0);
  const capacity = capacityForEvent(eventId);
  return { sold, revenue, checkedIn, capacity, percent: pct(sold, capacity) };
}

// Percent with one decimal place for small values (0.4%), whole numbers otherwise (37%)
function pct(part, whole) {
  if (!whole) return 0;
  const p = part / whole * 100;
  return p > 0 && p < 10 ? Math.round(p * 10) / 10 : Math.round(p);
}

function barHtml(percent) {
  return `<div class="bar"><div class="bar-fill" style="width:${Math.min(100, percent)}%"></div></div>`;
}

// ---------- Cart (saved per student in the browser until checkout) ----------

function cartKey() { const u = getCurrentUser(); return (USE_MOCK ? "ep_cart_" : "ep_live_cart_") + (u ? u.UserID : "guest"); }

function getCart() {
  try { return JSON.parse(localStorage.getItem(cartKey())) || []; } catch (e) { return []; }
}

function saveCart(cart) {
  localStorage.setItem(cartKey(), JSON.stringify(cart.filter(c => c.Quantity > 0)));
  updateCartCount();
}

function addToCart(ticketTypeId, quantity) {
  const cart = getCart();
  const line = cart.find(c => c.TicketTypeID === ticketTypeId);
  if (line) line.Quantity += quantity; else cart.push({ TicketTypeID: ticketTypeId, Quantity: quantity });
  saveCart(cart);
}

function cartCount() { return getCart().reduce((s, c) => s + c.Quantity, 0); }

function updateCartCount() {
  const n = cartCount();
  document.querySelectorAll(".cart-count").forEach(el => {
    el.textContent = n;
    el.style.display = n ? "inline-block" : "none";
  });
}

const MAX_PER_TICKET = 10; // max tickets of one type per order

// A booking can be cancelled while it's confirmed and none of its events have started yet
function canCancel(booking) {
  return booking.Status === "Confirmed" && bookingEvents(booking.BookingID).every(ev => !isPast(ev));
}

// Simple yes/no pop-up for student pages (builds its own HTML)
function askConfirm(title, text, yesText, onYes) {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.innerHTML = `
    <div class="modal">
      <h2>${esc(title)}</h2>
      <p>${esc(text)}</p>
      <div class="modal-actions">
        <button class="btn btn-outline" data-no>Keep it</button>
        <button class="btn btn-danger" data-yes>${esc(yesText)}</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.addEventListener("click", async e => {
    if (e.target === wrap || e.target.hasAttribute("data-no")) return close();
    if (e.target.hasAttribute("data-yes")) {
      e.target.disabled = true;
      try { await onYes(); } catch (error) { toast(error.message); } finally { close(); }
    }
  });
}
