// Shared code for the Admin and Organizer dashboards (needs helpers.js first).
// Each page defines its own renderAll() function, which this file calls after every save.

// ---------- Modal (pop-up form) ----------

const modal = document.getElementById("modal");
const modalForm = document.getElementById("modal-form");
const modalMessage = document.getElementById("modal-message");
let modalSaveHandler = null;

// fields: [{ id, label, type, options:[{value,label}], value, required, placeholder }]
function fieldHtml(f) {
  const val = f.value == null ? "" : f.value;
  let input;
  if (f.type === "select") {
    input = `<select id="f-${f.id}">${f.options.map(o =>
      `<option value="${esc(o.value)}" ${String(o.value) === String(val) ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select>`;
  } else if (f.type === "textarea") {
    input = `<textarea id="f-${f.id}" placeholder="${esc(f.placeholder || "")}">${esc(val)}</textarea>`;
  } else if (f.type === "image") {
    input = `<img class="image-preview" id="f-${f.id}-preview" src="${esc(f.preview || "")}" alt="Event photo preview">
      <input type="file" id="f-${f.id}" accept="image/*">`;
  } else {
    input = `<input type="${f.type || "text"}" id="f-${f.id}" value="${esc(val)}" placeholder="${esc(f.placeholder || "")}" ${f.step ? `step="${f.step}"` : ""} ${f.min != null ? `min="${f.min}"` : ""}>`;
  }
  return `<div class="form-group"><label for="f-${f.id}">${esc(f.label)}</label>${input}</div>`;
}

function openModal({ title, html, saveText = "Save", danger = false, onSave }) {
  document.getElementById("modal-title").textContent = title;
  document.getElementById("modal-body").innerHTML = html;
  const saveBtn = document.getElementById("modal-save");
  saveBtn.textContent = saveText;
  saveBtn.className = danger ? "btn btn-danger" : "btn";
  saveBtn.disabled = false;
  modalMessage.className = "message";
  modalSaveHandler = onSave;
  modal.classList.remove("hidden");
  const first = modal.querySelector("input:not([type=file]), select, textarea");
  if (first) first.focus();
}

function closeModal() { modal.classList.add("hidden"); modalSaveHandler = null; }

function formValues(fields) {
  const values = {};
  fields.filter(f => f.type !== "image").forEach(f => { values[f.id] = document.getElementById("f-" + f.id).value.trim(); });
  return values;
}

function checkRequired(fields, values) {
  const missing = fields.filter(f => f.required && !values[f.id]).map(f => f.label);
  if (missing.length) throw new Error("Please fill in: " + missing.join(", "));
}

function confirmModal(title, text, onYes) {
  openModal({ title, html: `<p>${esc(text)}</p><br>`, saveText: "Yes, continue", danger: true, onSave: onYes });
}

document.getElementById("modal-cancel").addEventListener("click", closeModal);
modal.addEventListener("click", e => { if (e.target === modal) closeModal(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });

// Live preview when a photo is chosen
modal.addEventListener("change", async e => {
  if (e.target.type !== "file") return;
  try {
    const url = await readImageFile(e.target.files[0]);
    if (url) document.getElementById(e.target.id + "-preview").src = url;
  } catch (err) {
    showMessage(modalMessage, err.message, "error");
  }
});

modalForm.addEventListener("submit", async e => {
  e.preventDefault();
  if (!modalSaveHandler) return;
  const saveBtn = document.getElementById("modal-save");
  saveBtn.disabled = true;
  try {
    const keepOpen = await modalSaveHandler();
    if (!keepOpen) closeModal();
    await loadAll();
    renderAll();
  } catch (err) {
    const full = err && (err.name === "QuotaExceededError" || /quota/i.test(err.message));
    showMessage(modalMessage, full ? "Browser storage is full — try a smaller photo." : err.message, "error");
  } finally {
    saveBtn.disabled = false;
  }
});

// ---------- Tabs ----------

document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab").forEach(t => t.classList.add("hidden"));
    btn.classList.add("active");
    document.getElementById("tab-" + btn.dataset.tab).classList.remove("hidden");
  });
});

// ---------- Events & ticket types (used by both dashboards) ----------

// organizerId: null on the admin page (admin picks an organizer), or the logged-in organizer's ID
function eventFields(ev = {}, organizerId = null) {
  const fields = [
    { id: "Title", label: "Title", value: ev.Title, required: true },
    { id: "Description", label: "Description", type: "textarea", value: ev.Description },
    { id: "CategoryID", label: "Category", type: "select", value: ev.CategoryID, options: db.Categories.map(c => ({ value: c.CategoryID, label: c.Name })) },
    { id: "VenueID", label: "Venue", type: "select", value: ev.VenueID, options: db.Venues.map(v => ({ value: v.VenueID, label: v.Name + " (" + v.Capacity + ")" })) }
  ];
  if (!organizerId) {
    const organizers = db.Users.filter(u => u.Role === "Organizer");
    fields.push({ id: "OrganizerID", label: "Organizer", type: "select", value: ev.OrganizerID, options: organizers.map(o => ({ value: o.UserID, label: fullName(o) })) });
  }
  fields.push(
    { id: "EventDate", label: "Date", type: "date", value: ev.EventDate, required: true },
    { id: "StartTime", label: "Start time", type: "time", value: ev.StartTime, required: true }
  );
  // The back end doesn't store photos yet, so the photo field only shows with the fake data
  if (USE_MOCK) fields.push({ id: "Image", label: "Event photo (optional)", type: "image", preview: ev.EventID ? eventImage(ev) : "" });
  return fields;
}

async function readEvent(fields, organizerId) {
  const v = formValues(fields);
  checkRequired(fields, v);
  const orgId = organizerId || Number(v.OrganizerID);
  if (!orgId) throw new Error("Add a staff organizer first (Users tab).");
  if (!v.CategoryID || !v.VenueID) throw new Error("Ask an admin to add a venue and category first.");
  const data = {
    Title: v.Title, Description: v.Description,
    CategoryID: Number(v.CategoryID), VenueID: Number(v.VenueID), OrganizerID: orgId,
    EventDate: v.EventDate, StartTime: v.StartTime
  };
  const photoInput = document.getElementById("f-Image");
  const photo = photoInput && await readImageFile(photoInput.files[0]);
  if (photo) data.ImageURL = photo;
  return data;
}

function ticketInputs(defaults) {
  return [
    { id: "TicketName", label: defaults.label, value: defaults.name, placeholder: "e.g. Student, General, VIP" },
    { id: "Price", label: "Price ($, 0 = free)", type: "number", value: 0, min: 0, step: "0.01" },
    { id: "Quantity", label: "Number of tickets", type: "number", value: defaults.qty, min: 1 }
  ];
}

function readTicket(fields) {
  const t = formValues(fields);
  const qty = parseInt(t.Quantity, 10), price = Number(t.Price);
  if (!t.TicketName) throw new Error("Enter a ticket type name.");
  if (!(qty > 0)) throw new Error("Number of tickets must be at least 1.");
  if (!(price >= 0)) throw new Error("Price can't be negative.");
  return { Name: t.TicketName, Price: price, QuantityTotal: qty, QuantityAvailable: qty };
}

function addEvent(organizerId = null) {
  const fields = eventFields({}, organizerId);
  const tFields = ticketInputs({ label: "First ticket type", name: "Student", qty: 100 });
  openModal({
    title: "Add event",
    html: fields.map(fieldHtml).join("") + tFields.map(fieldHtml).join(""),
    saveText: "Add event",
    onSave: async () => {
      const data = await readEvent(fields, organizerId);
      const ticket = readTicket(tFields);
      // Organizers' new events wait for an admin to approve them; admins' go live right away
      if (organizerId) {
        await submitEvent(data, ticket);
      } else {
        const ev = await createRow("Events", { ...data, Status: "Active" });
        await createRow("TicketTypes", { EventID: ev.EventID, ...ticket });
      }
      toast(organizerId ? "Event sent to an admin for approval." : "Event added.");
    }
  });
}

function editEvent(id, organizerId = null) {
  const ev = find("Events", id);
  const fields = eventFields(ev, organizerId);
  openModal({
    title: "Edit event",
    html: fields.map(fieldHtml).join(""),
    onSave: async () => {
      await updateRow("Events", id, await readEvent(fields, organizerId));
      toast("Event updated.");
    }
  });
}

function manageTickets(eventId) {
  const ev = find("Events", eventId);
  const tFields = ticketInputs({ label: "New ticket type", name: "", qty: 50 });
  openModal({
    title: "Tickets — " + ev.Title,
    html: `
      <table class="mini-table">
        <tr><th>Type</th><th>Price</th><th>Sold</th><th>Left</th><th></th></tr>
        ${ticketsForEvent(eventId).map(t => `
          <tr>
            <td>${esc(t.Name)}</td><td>${money(t.Price)}</td>
            <td>${t.QuantityTotal - t.QuantityAvailable}</td><td>${t.QuantityAvailable}</td>
            <td><button type="button" class="link-btn danger" data-action="delete-ticket" data-id="${t.TicketTypeID}">Remove</button></td>
          </tr>`).join("") || `<tr><td colspan="5" class="empty">No ticket types yet.</td></tr>`}
      </table>
      ${tFields.map(fieldHtml).join("")}`,
    saveText: "Add ticket type",
    onSave: async () => {
      await createRow("TicketTypes", { EventID: eventId, ...readTicket(tFields) });
      toast("Ticket type added.");
      await loadAll();
      manageTickets(eventId); // reopen with the new row
      return true;
    }
  });
}

async function deleteTicketType(id) {
  const t = find("TicketTypes", id);
  if (db.BookingItems.some(i => i.TicketTypeID === id)) {
    showMessage(modalMessage, "Students already booked this ticket type, so it can't be removed.", "error");
    return;
  }
  await deleteRow("TicketTypes", id);
  await loadAll();
  renderAll();
  manageTickets(t.EventID);
  toast("Ticket type removed.");
}

function toggleEvent(id) {
  const ev = find("Events", id);
  const isAdmin = (getCurrentUser() || {}).Role === "Admin";
  // Restoring: admins make it Active again; organizers send it back for approval
  const next = ev.Status !== "Cancelled" ? "Cancelled" : (isAdmin ? "Active" : "Pending");
  const booked = soldForEvent(id);
  const text = next === "Cancelled"
    ? `"${ev.Title}" will be cancelled and hidden from students.` +
      (booked ? ` ${booked} ticket(s) are booked — those students will see it's cancelled and can cancel for a refund.` : "")
    : `"${ev.Title}" will be ${next === "Active" ? "back on sale" : "sent to an admin for approval again"}.`;
  confirmModal(next === "Cancelled" ? "Cancel event?" : "Restore event?", text, async () => {
    await updateRow("Events", id, { Status: next });
    toast(next === "Cancelled" ? "Event cancelled." : next === "Active" ? "Event restored." : "Event sent for approval.");
  });
}

function deleteEvent(id) {
  const ev = find("Events", id);
  const ticketIds = ticketsForEvent(id).map(t => t.TicketTypeID);
  if (db.BookingItems.some(i => ticketIds.includes(i.TicketTypeID))) {
    toast("This event has bookings — cancel it instead of deleting.");
    return;
  }
  confirmModal("Delete event?", `"${ev.Title}" and its ticket types will be permanently deleted.`, async () => {
    for (const tid of ticketIds) await deleteRow("TicketTypes", tid);
    await deleteRow("Events", id);
    toast("Event deleted.");
  });
}

// One events table row, used by both dashboards
function eventRowHtml(e, showOrganizer) {
  return `
    <tr>
      <td><img class="thumb" src="${esc(eventImage(e))}" alt=""></td>
      <td><strong>${esc(e.Title)}</strong></td>
      <td>${esc((find("Categories", e.CategoryID) || {}).Name || "—")}</td>
      <td>${fmtDate(e.EventDate)}<div class="list-sub">${fmtTime(e.StartTime)}</div></td>
      <td>${esc((find("Venues", e.VenueID) || {}).Name || "—")}</td>
      ${showOrganizer ? `<td>${esc(fullName(find("Users", e.OrganizerID)))}</td>` : ""}
      <td>${soldForEvent(e.EventID)} / ${capacityForEvent(e.EventID)}</td>
      <td>${priceRange(e.EventID)}</td>
      <td>${badge(e.Status)}</td>
      <td class="actions">
        ${showOrganizer && e.Status === "Pending" ? `<button class="link-btn approve" data-action="approve-event" data-id="${e.EventID}">Approve</button>` : ""}
        ${USE_MOCK ? manageButtons(e, showOrganizer) : (showOrganizer && e.Status === "Pending" ? "" : `<span class="list-sub">More actions coming soon</span>`)}
      </td>
    </tr>`;
}

// Edit / tickets / cancel / delete — only with the fake data until the back end has these endpoints
function manageButtons(e, showOrganizer) {
  return `
        <button class="link-btn" data-action="edit-event" data-id="${e.EventID}">Edit</button>
        <button class="link-btn" data-action="tickets" data-id="${e.EventID}">Tickets</button>
        ${showOrganizer ? "" : `<button class="link-btn" data-action="view-attendees" data-id="${e.EventID}">Attendees</button>`}
        <button class="link-btn" data-action="toggle-event" data-id="${e.EventID}">${e.Status === "Cancelled" ? "Restore" : "Cancel"}</button>
        <button class="link-btn danger" data-action="delete-event" data-id="${e.EventID}">Delete</button>`;
}

// ---------- Button clicks ----------
// Pages add their own entries to this object: actions["name"] = function (id) { ... }
const actions = {
  "tickets": manageTickets, "toggle-event": toggleEvent, "delete-event": deleteEvent, "delete-ticket": deleteTicketType
};

document.addEventListener("click", e => {
  const btn = e.target.closest("[data-action]");
  if (!btn || !actions[btn.dataset.action]) return;
  e.preventDefault();
  actions[btn.dataset.action](Number(btn.dataset.id));
});

// ---------- Sales & attendance report table (used by both dashboards) ----------

function salesTableHtml(events, showOrganizer) {
  const rows = events.map(e => ({ e, s: eventSales(e.EventID) }));
  const sum = rows.reduce((t, r) => ({ sold: t.sold + r.s.sold, capacity: t.capacity + r.s.capacity,
    checkedIn: t.checkedIn + r.s.checkedIn, revenue: t.revenue + r.s.revenue }), { sold: 0, capacity: 0, checkedIn: 0, revenue: 0 });
  const cols = showOrganizer ? 9 : 8;
  return `
    <tr><th>Event</th><th>Date</th>${showOrganizer ? "<th>Organizer</th>" : ""}<th>Status</th><th>Sold</th><th>% sold</th><th>Checked in</th><th>Attendance</th><th>Revenue</th></tr>
    ${rows.map(({ e, s }) => `
      <tr>
        <td><strong>${esc(e.Title)}</strong><div class="list-sub">${ticketsForEvent(e.EventID).map(t =>
          esc(t.Name) + ": " + (t.QuantityTotal - t.QuantityAvailable) + "/" + t.QuantityTotal).join(" · ")}</div></td>
        <td>${fmtDate(e.EventDate)}</td>
        ${showOrganizer ? `<td>${esc(fullName(find("Users", e.OrganizerID)))}</td>` : ""}
        <td>${badge(e.Status)}</td>
        <td>${s.sold} / ${s.capacity}</td>
        <td>${barHtml(s.percent)}<div class="list-sub">${s.percent}%</div></td>
        <td>${s.checkedIn}</td>
        <td>${isPast(e) && s.sold ? Math.round(s.checkedIn / s.sold * 100) + "%" : "—"}</td>
        <td>$${s.revenue.toFixed(2)}</td>
      </tr>`).join("") || `<tr><td colspan="${cols}" class="empty">No events in this report.</td></tr>`}
    ${rows.length ? `<tr class="report-total"><td>Total</td><td></td>${showOrganizer ? "<td></td>" : ""}<td></td>
      <td>${sum.sold} / ${sum.capacity}</td><td>${pct(sum.sold, sum.capacity)}%</td>
      <td>${sum.checkedIn}</td><td></td><td>$${sum.revenue.toFixed(2)}</td></tr>` : ""}`;
}

// Filters events for a report by time: "upcoming", "past" or "" (all)
function reportEvents(events, when) {
  return events.filter(e => e.Status !== "Pending")
    .filter(e => !when || (when === "past" ? isPast(e) : !isPast(e)))
    .sort((a, b) => a.EventDate.localeCompare(b.EventDate));
}

// ---------- Phones: tables turn into cards ----------
// Copies each column heading onto its cells (data-label) so CSS can show "Label: value" on small screens.
function labelTable(table) {
  const heads = [...table.querySelectorAll("tr:first-child th")].map(th => th.textContent.trim());
  table.querySelectorAll("tr").forEach(tr => {
    [...tr.children].forEach((td, i) => { if (td.tagName === "TD" && heads[i] !== undefined) td.dataset.label = heads[i]; });
  });
}
new MutationObserver(muts => {
  const tables = new Set(muts.map(m => m.target.closest && m.target.closest("table")).filter(Boolean));
  tables.forEach(labelTable);
}).observe(document.body, { childList: true, subtree: true });
