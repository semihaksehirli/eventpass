// All data calls go through this file.
// Right now it uses fake data saved in the browser (localStorage).
// When the back end is ready: set USE_MOCK = false and API_BASE_URL to the back-end server.
// Each function then calls the matching REST endpoint shown in its comment.

// Pages served under /student/ use the same-origin API. Other copies keep mock mode.
const USE_MOCK = !window.location.pathname.startsWith("/student/");
const API_BASE_URL = "/api";
const SESSION_KEY = USE_MOCK ? "ep_currentUser" : "ep_liveStudent";

// ---------- Fake-data storage (mock mode only) ----------

function seedIfNeeded() {
  if (localStorage.getItem("ep_version") === String(DATA_VERSION)) return;
  Object.keys(MOCK_DATA).forEach(table => {
    localStorage.setItem("ep_" + table, JSON.stringify(MOCK_DATA[table]));
  });
  Object.keys(localStorage).filter(k => k.startsWith("ep_cart_")).forEach(k => localStorage.removeItem(k));
  localStorage.setItem("ep_version", String(DATA_VERSION));
  localStorage.removeItem("ep_currentUser");
}

function loadTable(table) {
  seedIfNeeded();
  return JSON.parse(localStorage.getItem("ep_" + table) || "[]");
}

function saveTable(table, rows) {
  localStorage.setItem("ep_" + table, JSON.stringify(rows));
}

// Today's date (local time) as YYYY-MM-DD
function todayISO() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

// Hide the password before handing a user to the pages
function publicUser(user) {
  const { Password, ...rest } = user;
  return rest;
}

// Sends one request to the back end. If the login response included a "token",
// it is sent back on every request as "Authorization: Bearer <token>".
async function request(method, path, body) {
  const headers = { "Content-Type": "application/json" };
  const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
  if (saved && saved.token) headers.Authorization = "Bearer " + saved.token;
  const res = await fetch(API_BASE_URL + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && saved?.token) {
      localStorage.removeItem(SESSION_KEY);
      window.location.replace("login.html");
    }
    throw new Error(data.message || "Request failed");
  }
  return data;
}

// ---------- Generic CRUD ----------
// table names match the database: Users, Venues, Categories, Events, TicketTypes,
// Bookings, BookingItems, Payments, Tickets

// GET /api/{table}
async function getAll(table) {
  if (!USE_MOCK) return request("GET", "/" + table.toLowerCase());
  const rows = loadTable(table);
  return table === "Users" ? rows.map(publicUser) : rows;
}

// POST /api/{table}
async function createRow(table, data) {
  if (!USE_MOCK) return request("POST", "/" + table.toLowerCase(), data);
  const rows = loadTable(table);
  const key = TABLE_KEYS[table];
  const newRow = { [key]: rows.length ? Math.max(...rows.map(r => r[key])) + 1 : 1, ...data };
  rows.push(newRow);
  saveTable(table, rows);
  return newRow;
}

// PUT /api/{table}/{id}
async function updateRow(table, id, changes) {
  if (!USE_MOCK) return request("PUT", "/" + table.toLowerCase() + "/" + id, changes);
  const rows = loadTable(table);
  const key = TABLE_KEYS[table];
  const row = rows.find(r => r[key] === id);
  if (!row) throw new Error("Record not found.");
  Object.assign(row, changes);
  saveTable(table, rows);
  return row;
}

// DELETE /api/{table}/{id}
async function deleteRow(table, id) {
  if (!USE_MOCK) return request("DELETE", "/" + table.toLowerCase() + "/" + id);
  const key = TABLE_KEYS[table];
  saveTable(table, loadTable(table).filter(r => r[key] !== id));
  return { deleted: id };
}

// ---------- Auth ----------

// POST /api/register   Role: "Customer" (WPU student) or "Organizer"
async function registerUser(data) {
  if (!USE_MOCK) return request("POST", "/register", data);
  const users = loadTable("Users");
  if (users.some(u => u.Email.toLowerCase() === data.Email.toLowerCase())) {
    throw new Error("An account with this email already exists.");
  }
  if (data.StudentID && users.some(u => u.StudentID === data.StudentID)) {
    throw new Error("This student ID is already registered.");
  }
  const role = data.Role === "Organizer" ? "Organizer" : "Customer";
  const user = await createRow("Users", { ...data, Role: role, CreatedAt: todayISO() });
  return publicUser(user);
}

// POST /api/login
async function loginUser(email, password) {
  if (!USE_MOCK) return request("POST", "/login", { Email: email, Password: password });
  const user = loadTable("Users").find(u => u.Email.toLowerCase() === email.toLowerCase() && u.Password === password);
  if (!user) throw new Error("Incorrect email or password.");
  return publicUser(user);
}

// ---------- Bookings ----------

// POST /api/bookings
// items: [{ TicketTypeID, Quantity }], payment: { cardLast4 } or null for free orders
// Creates the Booking, its BookingItems, the Payment and one Ticket per seat.
async function createBooking(userId, items, payment) {
  if (!USE_MOCK) return request("POST", "/bookings", { UserID: userId, Items: items, Payment: payment });

  const types = loadTable("TicketTypes");
  const events = loadTable("Events");
  let total = 0;

  // Check every line first, so nothing is saved if one line fails
  for (const item of items) {
    const type = types.find(t => t.TicketTypeID === item.TicketTypeID);
    const ev = type && events.find(e => e.EventID === type.EventID);
    if (!type || !ev) throw new Error("A ticket in your cart no longer exists.");
    if (ev.Status !== "Active") throw new Error(`"${ev.Title}" is no longer available.`);
    if (ev.EventDate < todayISO()) throw new Error(`"${ev.Title}" has already happened.`);
    if (item.Quantity > type.QuantityAvailable) {
      throw new Error(`Only ${type.QuantityAvailable} ${type.Name} ticket(s) left for "${ev.Title}".`);
    }
    total += type.Price * item.Quantity;
  }
  if (total > 0 && !payment) throw new Error("Payment is required.");

  const booking = await createRow("Bookings", {
    UserID: userId, BookingDate: todayISO(), TotalAmount: Math.round(total * 100) / 100, Status: "Confirmed"
  });

  for (const item of items) {
    const type = types.find(t => t.TicketTypeID === item.TicketTypeID);
    const line = await createRow("BookingItems", {
      BookingID: booking.BookingID, TicketTypeID: type.TicketTypeID, Quantity: item.Quantity, UnitPrice: type.Price
    });
    await updateRow("TicketTypes", type.TicketTypeID, { QuantityAvailable: type.QuantityAvailable - item.Quantity });
    for (let n = 1; n <= item.Quantity; n++) {
      await createRow("Tickets", {
        BookingItemID: line.BookingItemID,
        TicketCode: "EP-" + String(booking.BookingID).padStart(4, "0") + "-" + line.BookingItemID + n,
        IsCheckedIn: false
      });
    }
  }

  if (total > 0) {
    await createRow("Payments", {
      BookingID: booking.BookingID, Amount: booking.TotalAmount,
      PaymentMethod: "Card •••• " + payment.cardLast4, PaymentDate: todayISO(), Status: "Paid"
    });
  }
  return booking;
}

// POST /api/bookings/{id}/cancel
// Cancels the booking, puts the seats back on sale and refunds the payment.
async function cancelBooking(bookingId) {
  if (!USE_MOCK) return request("POST", "/bookings/" + bookingId + "/cancel");
  const booking = loadTable("Bookings").find(b => b.BookingID === bookingId);
  if (!booking || booking.Status !== "Confirmed") throw new Error("This booking can't be cancelled.");

  for (const item of loadTable("BookingItems").filter(i => i.BookingID === bookingId)) {
    const type = loadTable("TicketTypes").find(t => t.TicketTypeID === item.TicketTypeID);
    if (type) await updateRow("TicketTypes", type.TicketTypeID, { QuantityAvailable: type.QuantityAvailable + item.Quantity });
  }
  const payment = loadTable("Payments").find(p => p.BookingID === bookingId);
  if (payment) await updateRow("Payments", payment.PaymentID, { Status: "Refunded" });
  return updateRow("Bookings", bookingId, { Status: "Cancelled" });
}

// PUT /api/booking-items/{id}/check-in   (marks every ticket on that line)
async function setCheckedIn(bookingItemId, checkedIn) {
  if (!USE_MOCK) return request("PUT", "/booking-items/" + bookingItemId + "/check-in", { IsCheckedIn: checkedIn });
  const tickets = loadTable("Tickets");
  tickets.filter(t => t.BookingItemID === bookingItemId).forEach(t => { t.IsCheckedIn = checkedIn; });
  saveTable("Tickets", tickets);
  return { BookingItemID: bookingItemId, IsCheckedIn: checkedIn };
}

// ---------- Live dashboards (organizer + admin) ----------
// These use the endpoints the back end has so far:
//   GET  /api/categories, /api/venues, /api/events, /api/tickettypes   (approved catalog)
//   GET  /api/organizer/events          organizer's own events (any status)
//   POST /api/organizer/events          submit a new event as Pending
//   GET  /api/admin/events/pending      events waiting for approval
//   POST /api/admin/events/{id}/approve approve one

// Loads what an organizer or admin dashboard needs, in the same shape as the fake data.
async function loadLiveDashboard(role) {
  const [Categories, Venues, catalog, TicketTypes] = await Promise.all(
    ["/categories", "/venues", "/events", "/tickettypes"].map(path => request("GET", path)));
  let Events = catalog;
  if (role === "Organizer") {
    // Their own events (any status) plus everyone's approved events for the browse page
    const mine = await request("GET", "/organizer/events");
    const mineIds = new Set(mine.map(e => e.EventID));
    Events = mine.concat(catalog.filter(e => !mineIds.has(e.EventID)));
  }
  if (role === "Admin") Events = catalog.concat(await request("GET", "/admin/events/pending"));

  // The API doesn't list users yet, so show organizers by number
  const me = getCurrentUser();
  const Users = [...new Set(Events.map(e => e.OrganizerID))]
    .filter(id => !me || id !== me.UserID)
    .map(id => ({ UserID: id, FirstName: "Organizer", LastName: "#" + id, Role: "Organizer" }));
  if (me) Users.push(me);

  return { Users, Categories, Venues, Events, TicketTypes,
    Bookings: [], BookingItems: [], Payments: [], Tickets: [] };
}

// Organizer submits an event with its first ticket type. Prices go to the API in cents.
async function submitEvent(event, ticket) {
  if (USE_MOCK) {
    const ev = await createRow("Events", { ...event, Status: "Pending" });
    await createRow("TicketTypes", { EventID: ev.EventID, ...ticket });
    return ev;
  }
  const { ImageURL, OrganizerID, ...details } = event; // the API sets the organizer from the login
  return request("POST", "/organizer/events", {
    ...details,
    TicketTypes: [{ Name: ticket.Name, PriceCents: Math.round(ticket.Price * 100), QuantityTotal: ticket.QuantityTotal }]
  });
}

// Admin approves a pending event
async function approveEvent(eventId) {
  if (USE_MOCK) return updateRow("Events", eventId, { Status: "Active" });
  return request("POST", "/admin/events/" + eventId + "/approve");
}
