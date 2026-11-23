import { randomUUID } from "node:crypto";
import { RequestError } from "./auth.mjs";

const campusClock = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23"
});

export function createStudentApi(db, catalog) {
  const selectBookings = db.prepare(`
    SELECT b.*, SUM(t.PriceCents) / 100.0 AS TotalAmount
    FROM Bookings b JOIN Tickets k USING (BookingID) JOIN TicketTypes t USING (TicketTypeID)
    WHERE b.UserID = ? GROUP BY b.BookingID ORDER BY b.BookingID DESC
  `);
  const selectTickets = db.prepare(`
    SELECT k.*, t.PriceCents / 100.0 AS UnitPrice FROM Tickets k
    JOIN Bookings b USING (BookingID) JOIN TicketTypes t USING (TicketTypeID)
    WHERE b.UserID = ? ORDER BY k.TicketCode
  `);
  const organizers = db.prepare(`
    SELECT DISTINCT u.UserID, u.FirstName, u.LastName FROM Users u JOIN Events e ON e.OrganizerID = u.UserID
    WHERE e.Status = 'Active'
  `);
  const available = db.prepare(`
    SELECT t.PriceCents, e.Status, e.EventDate, e.StartTime, t.QuantityTotal - (
      SELECT COUNT(*) FROM Tickets k JOIN Bookings b USING (BookingID)
      WHERE k.TicketTypeID = t.TicketTypeID AND b.Status = 'Confirmed'
    ) AS Remaining
    FROM TicketTypes t JOIN Events e USING (EventID) WHERE t.TicketTypeID = ?
  `);
  const reserve = db.prepare("INSERT INTO Bookings (BookingDate, Status, UserID) VALUES (?, 'Confirmed', ?) RETURNING *");
  const ticket = db.prepare("INSERT INTO Tickets (TicketCode, BookingID, TicketTypeID) VALUES (?, ?, ?)");
  const cancellation = db.prepare(`
    UPDATE Bookings SET Status = 'Cancelled'
    WHERE BookingID = ? AND UserID = ? AND Status = 'Confirmed'
      AND NOT EXISTS (
        SELECT 1 FROM Tickets k JOIN TicketTypes t USING (TicketTypeID) JOIN Events e USING (EventID)
        WHERE k.BookingID = Bookings.BookingID AND (k.CheckedIn = 1 OR e.EventDate || ' ' || e.StartTime <= ?)
      )
    RETURNING *
  `);

  return {
    snapshot(user) {
      const items = new Map();
      const tickets = selectTickets.all(user.UserID).map(row => {
        const id = row.BookingID + "-" + row.TicketTypeID;
        if (!items.has(id)) {
          items.set(id, {
            BookingItemID: id, BookingID: row.BookingID, TicketTypeID: row.TicketTypeID,
            Quantity: 0, UnitPrice: row.UnitPrice
          });
        }
        items.get(id).Quantity++;
        return { BookingItemID: id, TicketCode: row.TicketCode, IsCheckedIn: Boolean(row.CheckedIn) };
      });
      return {
        Users: [...organizers.all(), user],
        Venues: catalog.get("/api/venues").all(),
        Categories: catalog.get("/api/categories").all(),
        Events: catalog.get("/api/events").all(),
        TicketTypes: catalog.get("/api/tickettypes").all(),
        Bookings: selectBookings.all(user.UserID), BookingItems: [...items.values()], Tickets: tickets, Payments: []
      };
    },

    book(user, body) {
      const { Items, Payment } = body;
      const quantities = new Map();
      if (!Array.isArray(Items) || !Items.length || Items.length > 30 || Payment != null) {
        throw new RequestError(400, "Choose up to 30 free ticket types per booking.");
      }
      for (const item of Items) {
        const { TicketTypeID, Quantity } = item ?? {};
        if (!Number.isSafeInteger(TicketTypeID) || TicketTypeID < 1 ||
            !Number.isSafeInteger(Quantity) || Quantity < 1 || Quantity > 10 || quantities.has(TicketTypeID)) {
          throw new RequestError(400, "Choose 1 to 10 tickets per ticket type.");
        }
        quantities.set(TicketTypeID, Quantity);
      }

      const now = campusClock.format(new Date());
      const today = now.slice(0, 10);
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const [id, quantity] of quantities) {
          const type = available.get(id);
          if (!type || type.Status !== "Active" || type.EventDate + " " + type.StartTime <= now || type.Remaining < quantity) {
            throw new RequestError(409, "A ticket in your cart is unavailable.");
          }
          if (type.PriceCents !== 0) throw new RequestError(400, "Only free tickets can be booked in this version.");
        }
        const booking = reserve.get(today, user.UserID);
        for (const [id, quantity] of quantities) {
          for (let seat = 0; seat < quantity; seat++) ticket.run("EP-" + randomUUID(), booking.BookingID, id);
        }
        db.exec("COMMIT");
        return { ...booking, TotalAmount: 0 };
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },

    cancel(user, id) {
      if (!Number.isSafeInteger(id)) throw new RequestError(400, "Invalid booking number.");
      const booking = cancellation.get(id, user.UserID, campusClock.format(new Date()));
      if (!booking) throw new RequestError(409, "This booking cannot be cancelled.");
      return booking;
    }
  };
}
