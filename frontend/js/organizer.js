// Organizer dashboard (Feature 6) — organizers manage only their own events.
// Shared helpers are in helpers.js; the pop-up form and event/ticket functions are in common.js.
const organizer = requireLogin(["Organizer"]);

function myEvents() { return db.Events.filter(e => e.OrganizerID === organizer.UserID); }

function isMine(eventId) {
  const ev = find("Events", eventId);
  return ev && ev.OrganizerID === organizer.UserID;
}

// Every ticket line booked for one of my events
function myBookingLines() {
  const myTicketIds = new Set(db.TicketTypes.filter(t => isMine(t.EventID)).map(t => t.TicketTypeID));
  return db.BookingItems
    .filter(i => myTicketIds.has(i.TicketTypeID))
    .map(i => {
      const booking = find("Bookings", i.BookingID);
      const ticket = find("TicketTypes", i.TicketTypeID);
      return { item: i, booking, ticket, event: find("Events", ticket.EventID), student: find("Users", booking.UserID) };
    });
}

// ---------- Stats ----------

function renderStats() {
  const mine = myEvents();
  const confirmedLines = myBookingLines().filter(l => l.booking.Status === "Confirmed");
  const ticketsSold = confirmedLines.reduce((sum, l) => sum + l.item.Quantity, 0);
  const revenue = confirmedLines.reduce((sum, l) => sum + l.item.Quantity * l.item.UnitPrice, 0);
  const upcoming = mine.filter(e => e.Status === "Active" && !isPast(e)).length;
  const attendees = new Set(confirmedLines.map(l => l.booking.UserID)).size;

  document.getElementById("stats").innerHTML = [
    ["Upcoming events", upcoming],
    ["Tickets sold", ticketsSold],
    ["Students attending", attendees],
    ["Revenue", "$" + revenue.toFixed(2)]
  ].map(([label, value]) => `<div class="stat"><div class="stat-label">${label}</div><div class="stat-value">${value}</div></div>`).join("");
}

// ---------- My events ----------

function renderEvents() {
  const search = document.getElementById("event-search").value.trim().toLowerCase();
  const time = document.getElementById("event-time-filter").value;
  const status = document.getElementById("event-status-filter").value;

  const pending = myEvents().filter(e => e.Status === "Pending").length;
  const banner = document.getElementById("pending-banner");
  banner.classList.toggle("hidden", !pending);
  banner.textContent = pending === 1
    ? "1 of your events is waiting for admin approval. Students can't see it yet."
    : `${pending} of your events are waiting for admin approval. Students can't see them yet.`;

  const rows = myEvents()
    .filter(e => !search || e.Title.toLowerCase().includes(search))
    .filter(e => !time || (time === "upcoming" ? !isPast(e) : isPast(e)))
    .filter(e => !status || e.Status === status)
    .sort((a, b) => a.EventDate.localeCompare(b.EventDate));

  document.getElementById("events-table").innerHTML = `
    <tr><th></th><th>Event</th><th>Category</th><th>Date &amp; time</th><th>Venue</th><th>Sold</th><th>Price</th><th>Status</th><th>Actions</th></tr>
    ${rows.map(e => eventRowHtml(e, false)).join("") ||
      `<tr><td colspan="9" class="empty">No events here yet. Click "+ Create event" to add one.</td></tr>`}`;
}

document.getElementById("add-event-btn").addEventListener("click", () => addEvent(organizer.UserID));

// Organizers can only change their own events
function onlyMine(fn) {
  return id => isMine(id) ? fn(id) : toast("You can only manage your own events.");
}
actions["edit-event"] = onlyMine(id => editEvent(id, organizer.UserID));
actions["tickets"] = onlyMine(manageTickets);
actions["toggle-event"] = onlyMine(toggleEvent);
actions["delete-event"] = onlyMine(deleteEvent);
actions["view-attendees"] = id => {
  document.querySelector('[data-tab="attendees"]').click();
  document.getElementById("attendee-event-filter").value = String(id);
  renderAttendees();
};

// ---------- Attendees & check-in ----------

function renderAttendeeFilter() {
  const sel = document.getElementById("attendee-event-filter");
  const current = sel.value;
  sel.innerHTML = `<option value="">All my events</option>` +
    myEvents().filter(e => e.Status !== "Pending").sort((a, b) => a.EventDate.localeCompare(b.EventDate))
      .map(e => `<option value="${e.EventID}">${esc(e.Title)} (${fmtDate(e.EventDate)})</option>`).join("");
  sel.value = current;
}

function renderAttendees() {
  const eventId = Number(document.getElementById("attendee-event-filter").value) || null;
  const search = document.getElementById("attendee-search").value.trim().toLowerCase();

  const lines = myBookingLines()
    .filter(l => !eventId || l.event.EventID === eventId)
    .filter(l => !search || [fullName(l.student), l.student ? l.student.Email : "", l.student ? l.student.StudentID : "",
      ...ticketsForItem(l.item.BookingItemID).map(t => t.TicketCode)].join(" ").toLowerCase().includes(search))
    .sort((a, b) => b.booking.BookingDate.localeCompare(a.booking.BookingDate));

  const confirmed = lines.filter(l => l.booking.Status === "Confirmed");
  const seats = confirmed.reduce((s, l) => s + l.item.Quantity, 0);
  const checkedIn = confirmed.reduce((s, l) => s + ticketsForItem(l.item.BookingItemID).filter(t => t.IsCheckedIn).length, 0);
  document.getElementById("attendee-summary").textContent =
    `${seats} confirmed ticket${seats === 1 ? "" : "s"} · ${checkedIn} checked in`;

  document.getElementById("attendees-table").innerHTML = `
    <tr><th>Student</th><th>Student ID</th><th>Event</th><th>Ticket</th><th>Qty</th><th>Ticket codes</th><th>Status</th><th>Check-in</th></tr>
    ${lines.map(l => {
      const tickets = ticketsForItem(l.item.BookingItemID);
      const allIn = tickets.length && tickets.every(t => t.IsCheckedIn);
      const ok = l.booking.Status === "Confirmed" && l.event.Status === "Active";
      return `
      <tr>
        <td><strong>${esc(fullName(l.student))}</strong><div class="list-sub">${esc(l.student ? l.student.Email : "")}</div></td>
        <td>${esc(l.student && l.student.StudentID || "—")}</td>
        <td>${esc(l.event.Title)}<div class="list-sub">${fmtDate(l.event.EventDate)}</div></td>
        <td>${esc(l.ticket.Name)} · ${money(l.item.UnitPrice)}</td>
        <td>${l.item.Quantity}</td>
        <td class="list-sub">${tickets.map(t => esc(t.TicketCode)).join("<br>")}</td>
        <td>${badge(l.booking.Status)}</td>
        <td class="actions">${!ok ? "—" : allIn
          ? `<span class="badge badge-active">Checked in</span> <button class="link-btn" data-action="undo-check-in" data-id="${l.item.BookingItemID}">Undo</button>`
          : `<button class="btn btn-small" data-action="check-in" data-id="${l.item.BookingItemID}">Check in</button>`}</td>
      </tr>`;
    }).join("") || `<tr><td colspan="8" class="empty">No students have booked yet.</td></tr>`}`;
}

async function checkIn(itemId, value) {
  await setCheckedIn(itemId, value);
  await loadAll();
  renderAll();
  toast(value ? "Checked in." : "Check-in undone.");
}
actions["check-in"] = id => checkIn(id, true);
actions["undo-check-in"] = id => checkIn(id, false);

// ---------- Sales ----------

function renderSales() {
  const when = document.getElementById("sales-when").value;
  document.getElementById("sales-table").innerHTML = salesTableHtml(reportEvents(myEvents(), when), false);
}

// ---------- Filters & first load ----------

["event-search", "event-time-filter", "event-status-filter"].forEach(id =>
  document.getElementById(id).addEventListener("input", renderEvents));
["attendee-event-filter", "attendee-search"].forEach(id =>
  document.getElementById(id).addEventListener("input", renderAttendees));
document.getElementById("sales-when").addEventListener("input", renderSales);

function renderAll() {
  renderStats();
  renderEvents();
  renderAttendeeFilter();
  renderAttendees();
  renderSales();
}

// Live site: "My Events" and "Create event" are connected; attendees and sales come later
function setUpLiveMode() {
  if (USE_MOCK) return;
  document.querySelectorAll(".tab-btn").forEach(btn => {
    if (btn.dataset.tab !== "events") btn.classList.add("hidden");
  });
  document.getElementById("stats").classList.add("hidden");
  document.getElementById("tab-events").insertAdjacentHTML("afterbegin",
    `<div class="pending-banner live-note">Connected to the live database. New events go to an admin for approval. Editing, attendees and sales will appear here once the back end supports them.</div>`);
}

if (organizer) {
  setUpLiveMode();
  loadAll().then(renderAll).catch(err => toast(err.message));
}
