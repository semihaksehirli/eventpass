// Admin dashboard — only Admin accounts can open this page.
// Shared helpers, the pop-up form and event/ticket functions live in common.js.
const admin = requireLogin(["Admin"]);

// ---------- Overview ----------

function renderOverview() {
  const confirmed = db.Bookings.filter(b => b.Status === "Confirmed");
  const ticketsSold = confirmed.reduce((sum, b) => sum + bookingTicketCount(b.BookingID), 0);
  const revenue = confirmed.reduce((sum, b) => sum + Number(b.TotalAmount), 0);
  const students = db.Users.filter(u => u.Role === "Customer").length;
  const upcoming = db.Events.filter(e => e.Status === "Active" && e.EventDate >= today())
    .sort((a, b) => a.EventDate.localeCompare(b.EventDate));

  const pending = db.Events.filter(e => e.Status === "Pending").length;
  document.getElementById("stats").innerHTML = [
    ["Students", students],
    ["Upcoming events", upcoming.length],
    ["Waiting for approval", pending],
    ["Tickets sold", ticketsSold],
    ["Revenue", "$" + revenue.toFixed(2)]
  ].map(([label, value]) => `<div class="stat"><div class="stat-label">${label}</div><div class="stat-value">${value}</div></div>`).join("");

  document.getElementById("upcoming-list").innerHTML = upcoming.slice(0, 5).map(e => `
    <div class="list-item">
      <div><strong>${esc(e.Title)}</strong><div class="list-sub">${fmtDate(e.EventDate)} · ${fmtTime(e.StartTime)}</div></div>
      <div class="list-sub">${soldForEvent(e.EventID)} / ${capacityForEvent(e.EventID)} sold</div>
    </div>`).join("") || `<p class="list-sub">No upcoming events.</p>`;

  const recent = [...db.Bookings].sort((a, b) => b.BookingID - a.BookingID).slice(0, 5);
  document.getElementById("recent-list").innerHTML = recent.map(b => `
    <div class="list-item">
      <div><strong>${esc(fullName(find("Users", b.UserID)))}</strong><div class="list-sub">${esc(eventsForBooking(b.BookingID).join(", "))}</div></div>
      <div style="text-align:right">${money(b.TotalAmount)}<div class="list-sub">${badge(b.Status)}</div></div>
    </div>`).join("") || `<p class="list-sub">No bookings yet.</p>`;
}

// ---------- Events (all organizers) ----------

function renderEvents() {
  const search = document.getElementById("event-search").value.trim().toLowerCase();
  const cat = document.getElementById("event-category-filter").value;
  const status = document.getElementById("event-status-filter").value;

  const rows = db.Events
    .filter(e => !search || e.Title.toLowerCase().includes(search))
    .filter(e => !cat || e.CategoryID === Number(cat))
    .filter(e => !status || e.Status === status)
    .sort((a, b) => a.EventDate.localeCompare(b.EventDate));

  // Pending-approval reminder + count on the sidebar tab
  const pending = db.Events.filter(e => e.Status === "Pending");
  const countEl = document.getElementById("pending-count");
  countEl.textContent = pending.length;
  countEl.classList.toggle("hidden", !pending.length);
  const banner = document.getElementById("pending-banner");
  banner.classList.toggle("hidden", !pending.length || status === "Pending");
  banner.innerHTML = `${pending.length} event${pending.length === 1 ? " is" : "s are"} waiting for your approval.
    <button type="button" id="show-pending">Show them</button>`;

  document.getElementById("events-table").innerHTML = `
    <tr><th></th><th>Event</th><th>Category</th><th>Date &amp; time</th><th>Venue</th><th>Organizer</th><th>Sold</th><th>Price</th><th>Status</th><th>Actions</th></tr>
    ${rows.map(e => eventRowHtml(e, true)).join("") || `<tr><td colspan="10" class="empty">No events found.</td></tr>`}`;
}

document.getElementById("add-event-btn").addEventListener("click", () => addEvent(null));
actions["edit-event"] = id => editEvent(id, null);

actions["approve-event"] = id => {
  const ev = find("Events", id);
  confirmModal("Approve event?", `"${ev.Title}" by ${fullName(find("Users", ev.OrganizerID))} will go live for students.`, async () => {
    await approveEvent(id);
    toast("Event approved.");
  });
  document.getElementById("modal-save").className = "btn"; // green-light, not a danger action
};

document.addEventListener("click", e => {
  if (e.target.id !== "show-pending") return;
  document.getElementById("event-status-filter").value = "Pending";
  renderEvents();
});

// ---------- Users ----------

function renderUsers() {
  const search = document.getElementById("user-search").value.trim().toLowerCase();
  const role = document.getElementById("user-role-filter").value;
  const rows = db.Users
    .filter(u => !role || u.Role === role)
    .filter(u => !search || [fullName(u), u.Email, u.StudentID || ""].join(" ").toLowerCase().includes(search));

  document.getElementById("users-table").innerHTML = `
    <tr><th>Name</th><th>Email</th><th>Student ID</th><th>Phone</th><th>Role</th><th>Joined</th><th>Actions</th></tr>
    ${rows.map(u => `
      <tr>
        <td><strong>${esc(fullName(u))}</strong></td>
        <td>${esc(u.Email)}</td>
        <td>${esc(u.StudentID || "—")}</td>
        <td>${esc(u.Phone)}</td>
        <td>${badge(u.Role)}</td>
        <td>${fmtDate(u.CreatedAt)}</td>
        <td class="actions">
          <button class="link-btn" data-action="edit-user" data-id="${u.UserID}">Edit</button>
          ${u.UserID !== admin.UserID ? `<button class="link-btn danger" data-action="delete-user" data-id="${u.UserID}">Delete</button>` : ""}
        </td>
      </tr>`).join("") || `<tr><td colspan="7" class="empty">No users found.</td></tr>`}`;
}

document.getElementById("add-organizer-btn").addEventListener("click", () => {
  const fields = [
    { id: "FirstName", label: "First name", required: true },
    { id: "LastName", label: "Last name", required: true },
    { id: "Email", label: "Email", placeholder: "name@example.com", required: true },
    { id: "Phone", label: "Phone", required: true },
    { id: "Password", label: "Temporary password", placeholder: "At least 8 characters", required: true }
  ];
  openModal({
    title: "Add organizer",
    html: fields.map(fieldHtml).join(""),
    saveText: "Add organizer",
    onSave: async () => {
      const v = formValues(fields);
      checkRequired(fields, v);
      if (!/^\S+@\S+\.\S+$/.test(v.Email)) throw new Error("Enter a valid email.");
      if (db.Users.some(u => u.Email.toLowerCase() === v.Email.toLowerCase())) throw new Error("That email is already in use.");
      if (v.Phone.replace(/\D/g, "").length !== 10) throw new Error("Enter a 10-digit phone number.");
      if (v.Password.length < 8) throw new Error("Password must be at least 8 characters.");
      await createRow("Users", { ...v, StudentID: null, Role: "Organizer", CreatedAt: today() });
      toast("Organizer added.");
    }
  });
});

actions["edit-user"] = id => {
  const u = find("Users", id);
  const fields = [
    { id: "FirstName", label: "First name", value: u.FirstName, required: true },
    { id: "LastName", label: "Last name", value: u.LastName, required: true },
    { id: "Phone", label: "Phone", value: u.Phone, required: true }
  ];
  if (u.Role === "Customer") fields.push({ id: "StudentID", label: "WPU student ID", value: u.StudentID, required: true });
  openModal({
    title: "Edit " + fullName(u),
    html: `<p class="list-sub" style="margin-bottom:14px">${esc(u.Email)} · ${u.Role === "Customer" ? "Student" : u.Role}</p>` + fields.map(fieldHtml).join(""),
    onSave: async () => {
      const v = formValues(fields);
      checkRequired(fields, v);
      if (v.Phone.replace(/\D/g, "").length !== 10) throw new Error("Enter a 10-digit phone number.");
      if (v.StudentID !== undefined && !/^855\d{6}$/.test(v.StudentID)) throw new Error("Student ID must be 9 digits starting with 855.");
      await updateRow("Users", id, v);
      toast("User updated.");
    }
  });
};

actions["delete-user"] = id => {
  const u = find("Users", id);
  if (db.Bookings.some(b => b.UserID === id)) { toast("This student has bookings and can't be deleted."); return; }
  if (db.Events.some(e => e.OrganizerID === id)) { toast("This organizer has events — reassign them first."); return; }
  confirmModal("Delete user?", `${fullName(u)} (${u.Email}) will be permanently deleted.`, async () => {
    await deleteRow("Users", id);
    toast("User deleted.");
  });
};

// ---------- Venues & Categories ----------

function renderVenues() {
  document.getElementById("venues-table").innerHTML = `
    <tr><th>Name</th><th>Address</th><th>Capacity</th><th>Events</th><th>Actions</th></tr>
    ${db.Venues.map(v => `
      <tr>
        <td><strong>${esc(v.Name)}</strong></td>
        <td>${esc(v.Address)}, ${esc(v.City)}, ${esc(v.State)}</td>
        <td>${v.Capacity}</td>
        <td>${db.Events.filter(e => e.VenueID === v.VenueID).length}</td>
        <td class="actions">
          <button class="link-btn" data-action="edit-venue" data-id="${v.VenueID}">Edit</button>
          <button class="link-btn danger" data-action="delete-venue" data-id="${v.VenueID}">Delete</button>
        </td>
      </tr>`).join("") || `<tr><td colspan="5" class="empty">No venues yet.</td></tr>`}`;

  document.getElementById("categories-table").innerHTML = `
    <tr><th>Category</th><th>Events</th><th>Actions</th></tr>
    ${db.Categories.map(c => `
      <tr>
        <td><strong>${esc(c.Name)}</strong></td>
        <td>${db.Events.filter(e => e.CategoryID === c.CategoryID).length}</td>
        <td class="actions">
          <button class="link-btn" data-action="edit-category" data-id="${c.CategoryID}">Rename</button>
          <button class="link-btn danger" data-action="delete-category" data-id="${c.CategoryID}">Delete</button>
        </td>
      </tr>`).join("") || `<tr><td colspan="3" class="empty">No categories yet.</td></tr>`}`;
}

function venueForm(v) {
  const fields = [
    { id: "Name", label: "Venue name", value: v && v.Name, required: true },
    { id: "Address", label: "Address", value: v ? v.Address : "300 Pompton Rd", required: true },
    { id: "City", label: "City", value: v ? v.City : "Wayne", required: true },
    { id: "State", label: "State", value: v ? v.State : "NJ", required: true },
    { id: "Capacity", label: "Capacity", type: "number", value: v && v.Capacity, min: 1, required: true }
  ];
  openModal({
    title: v ? "Edit venue" : "Add venue",
    html: fields.map(fieldHtml).join(""),
    onSave: async () => {
      const val = formValues(fields);
      checkRequired(fields, val);
      const cap = parseInt(val.Capacity, 10);
      if (!(cap > 0)) throw new Error("Capacity must be at least 1.");
      const data = { ...val, Capacity: cap };
      if (v) await updateRow("Venues", v.VenueID, data); else await createRow("Venues", data);
      toast(v ? "Venue updated." : "Venue added.");
    }
  });
}

function categoryForm(c) {
  const fields = [{ id: "Name", label: "Category name", value: c && c.Name, required: true }];
  openModal({
    title: c ? "Rename category" : "Add category",
    html: fields.map(fieldHtml).join(""),
    onSave: async () => {
      const v = formValues(fields);
      checkRequired(fields, v);
      if (db.Categories.some(x => x.Name.toLowerCase() === v.Name.toLowerCase() && (!c || x.CategoryID !== c.CategoryID))) {
        throw new Error("That category already exists.");
      }
      if (c) await updateRow("Categories", c.CategoryID, v); else await createRow("Categories", v);
      toast(c ? "Category renamed." : "Category added.");
    }
  });
}

document.getElementById("add-venue-btn").addEventListener("click", () => venueForm(null));
document.getElementById("add-category-btn").addEventListener("click", () => categoryForm(null));
actions["edit-venue"] = id => venueForm(find("Venues", id));
actions["edit-category"] = id => categoryForm(find("Categories", id));

actions["delete-venue"] = id => {
  const v = find("Venues", id);
  if (db.Events.some(e => e.VenueID === id)) { toast("Events use this venue — move them first."); return; }
  confirmModal("Delete venue?", `"${v.Name}" will be permanently deleted.`, async () => {
    await deleteRow("Venues", id);
    toast("Venue deleted.");
  });
};

actions["delete-category"] = id => {
  const c = find("Categories", id);
  if (db.Events.some(e => e.CategoryID === id)) { toast("Events use this category — change them first."); return; }
  confirmModal("Delete category?", `"${c.Name}" will be permanently deleted.`, async () => {
    await deleteRow("Categories", id);
    toast("Category deleted.");
  });
};

// ---------- Bookings ----------

function renderBookings() {
  const search = document.getElementById("booking-search").value.trim().toLowerCase();
  const status = document.getElementById("booking-status-filter").value;
  const rows = [...db.Bookings]
    .sort((a, b) => b.BookingID - a.BookingID)
    .filter(b => !status || b.Status === status)
    .filter(b => {
      if (!search) return true;
      const u = find("Users", b.UserID);
      return [fullName(u), u ? u.StudentID : "", ...eventsForBooking(b.BookingID)].join(" ").toLowerCase().includes(search);
    });

  document.getElementById("bookings-table").innerHTML = `
    <tr><th>#</th><th>Student</th><th>Event(s)</th><th>Tickets</th><th>Total</th><th>Payment</th><th>Date</th><th>Status</th><th>Actions</th></tr>
    ${rows.map(b => {
      const u = find("Users", b.UserID);
      const pay = paymentForBooking(b.BookingID);
      return `
      <tr>
        <td>${b.BookingID}</td>
        <td><strong>${esc(fullName(u))}</strong><div class="list-sub">${esc(u && u.StudentID ? u.StudentID : "")}</div></td>
        <td>${esc(eventsForBooking(b.BookingID).join(", "))}</td>
        <td>${bookingTicketCount(b.BookingID)}</td>
        <td>${money(b.TotalAmount)}</td>
        <td>${pay ? esc(pay.PaymentMethod) + "<div>" + badge(pay.Status) + "</div>" : "—"}</td>
        <td>${fmtDate(b.BookingDate)}</td>
        <td>${badge(b.Status)}</td>
        <td class="actions">${b.Status === "Confirmed"
          ? `<button class="link-btn danger" data-action="cancel-booking" data-id="${b.BookingID}">Cancel</button>` : "—"}</td>
      </tr>`;
    }).join("") || `<tr><td colspan="9" class="empty">No bookings found.</td></tr>`}`;
}

actions["cancel-booking"] = id => {
  const pay = paymentForBooking(id);
  confirmModal("Cancel booking?", `Booking #${id} will be cancelled and its tickets released` +
    (pay ? `, and $${Number(pay.Amount).toFixed(2)} refunded.` : "."), async () => {
    await cancelBooking(id);
    toast("Booking cancelled.");
  });
};

// ---------- Sales & attendance reports ----------

function renderReports() {
  const when = document.getElementById("report-when").value;
  const events = reportEvents(db.Events, when);
  const totals = events.map(e => eventSales(e.EventID))
    .reduce((t, s) => ({ sold: t.sold + s.sold, revenue: t.revenue + s.revenue, checkedIn: t.checkedIn + s.checkedIn, capacity: t.capacity + s.capacity }),
      { sold: 0, revenue: 0, checkedIn: 0, capacity: 0 });
  const pastSold = events.filter(isPast).reduce((s, e) => s + eventSales(e.EventID).sold, 0);
  const pastIn = events.filter(isPast).reduce((s, e) => s + eventSales(e.EventID).checkedIn, 0);

  document.getElementById("report-stats").innerHTML = [
    ["Tickets sold", totals.sold],
    ["Revenue", "$" + totals.revenue.toFixed(2)],
    ["Seats sold", totals.sold + " / " + totals.capacity.toLocaleString()],
    ["Attendance (past events)", pastSold ? Math.round(pastIn / pastSold * 100) + "%" : "—"]
  ].map(([label, value]) => `<div class="stat"><div class="stat-label">${label}</div><div class="stat-value">${value}</div></div>`).join("");

  document.getElementById("report-events").innerHTML = salesTableHtml(events, true);

  document.getElementById("report-categories").innerHTML = `
    <tr><th>Category</th><th>Events</th><th>Tickets sold</th><th>% sold</th><th>Revenue</th></tr>
    ${db.Categories.map(c => {
      const evs = events.filter(e => e.CategoryID === c.CategoryID);
      const s = evs.map(e => eventSales(e.EventID)).reduce((t, x) => ({ sold: t.sold + x.sold, capacity: t.capacity + x.capacity, revenue: t.revenue + x.revenue }), { sold: 0, capacity: 0, revenue: 0 });
      const pctSold = pct(s.sold, s.capacity);
      return `<tr><td><strong>${esc(c.Name)}</strong></td><td>${evs.length}</td><td>${s.sold}</td>
        <td>${barHtml(pctSold)}<div class="list-sub">${pctSold}%</div></td><td>$${s.revenue.toFixed(2)}</td></tr>`;
    }).join("")}`;
}

document.getElementById("report-when").addEventListener("input", renderReports);

// ---------- Filters & first load ----------

["event-search", "event-category-filter", "event-status-filter"].forEach(id =>
  document.getElementById(id).addEventListener("input", renderEvents));
["user-search", "user-role-filter"].forEach(id =>
  document.getElementById(id).addEventListener("input", renderUsers));
["booking-search", "booking-status-filter"].forEach(id =>
  document.getElementById(id).addEventListener("input", renderBookings));

function renderCategoryFilter() {
  const sel = document.getElementById("event-category-filter");
  const current = sel.value;
  sel.innerHTML = `<option value="">All categories</option>` +
    db.Categories.map(c => `<option value="${c.CategoryID}">${esc(c.Name)}</option>`).join("");
  sel.value = current;
}

function renderAll() {
  renderCategoryFilter();
  renderOverview();
  renderEvents();
  renderUsers();
  renderVenues();
  renderBookings();
  renderReports();
}

// Live site: only event approval is connected to the back end so far
function setUpLiveMode() {
  if (USE_MOCK) return;
  document.querySelectorAll(".tab-btn").forEach(btn => {
    if (btn.dataset.tab !== "events") btn.classList.add("hidden");
  });
  document.querySelector('[data-tab="events"]').click();
  document.getElementById("add-event-btn").classList.add("hidden");
  document.getElementById("tab-events").insertAdjacentHTML("afterbegin",
    `<div class="pending-banner live-note">Connected to the live database: approved and pending events. Users, venues, bookings and reports will appear here once the back end supports them.</div>`);
}

if (admin) {
  setUpLiveMode();
  loadAll().then(renderAll).catch(err => toast(err.message));
}
