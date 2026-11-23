import { RequestError } from "./auth.mjs";

export function createEventApproval(db) {
  const venue = db.prepare("SELECT Capacity FROM Venues WHERE VenueID = ?");
  const category = db.prepare("SELECT 1 FROM Categories WHERE CategoryID = ?");
  const create = db.prepare(`
    INSERT INTO Events (OrganizerID, VenueID, CategoryID, Title, Description, EventDate, StartTime, Status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending') RETURNING *
  `);
  const addType = db.prepare(`
    INSERT INTO TicketTypes (EventID, Name, PriceCents, QuantityTotal) VALUES (?, ?, ?, ?) RETURNING TicketTypeID
  `);
  const mine = db.prepare("SELECT * FROM Events WHERE OrganizerID = ? ORDER BY EventID DESC");
  const pending = db.prepare("SELECT * FROM Events WHERE Status = 'Pending' ORDER BY EventID");
  const approve = db.prepare("UPDATE Events SET Status = 'Active' WHERE EventID = ? AND Status = 'Pending' RETURNING *");
  const text = value => typeof value === "string" ? value.trim() : "";

  return {
    mine: id => mine.all(id),
    pending: () => pending.all(),
    approve(id) {
      if (!Number.isSafeInteger(id) || id < 1) throw new RequestError(400, "Invalid event ID.");
      const event = approve.get(id);
      if (!event) throw new RequestError(409, "Only pending events can be approved.");
      return event;
    },
    submit(user, body) {
      const { VenueID, CategoryID, TicketTypes } = body;
      const title = text(body.Title);
      const description = text(body.Description);
      const date = text(body.EventDate);
      const time = text(body.StartTime);
      const parsedDate = new Date(date + "T00:00:00Z");
      if (!title || title.length > 150 || description.length > 2000 ||
          !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsedDate.valueOf()) ||
          parsedDate.toISOString().slice(0, 10) !== date || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) ||
          !Number.isSafeInteger(VenueID) || !Number.isSafeInteger(CategoryID) ||
          !Array.isArray(TicketTypes) || !TicketTypes.length || TicketTypes.length > 20) {
        throw new RequestError(400, "Provide event details and 1 to 20 ticket types.");
      }

      const names = new Set();
      const types = TicketTypes.map(type => {
        const { PriceCents, QuantityTotal } = type ?? {};
        const name = text(type?.Name);
        if (!name || name.length > 80 || names.has(name.toLowerCase()) ||
            !Number.isSafeInteger(PriceCents) || PriceCents < 0 || PriceCents > 1000000 ||
            !Number.isSafeInteger(QuantityTotal) || QuantityTotal < 1 || QuantityTotal > 1000000) {
          throw new RequestError(400, "Ticket types need unique names, a price in cents, and a positive seat quantity.");
        }
        names.add(name.toLowerCase());
        return { Name: name, PriceCents, QuantityTotal };
      });

      db.exec("BEGIN IMMEDIATE");
      try {
        const location = venue.get(VenueID);
        if (!location || !category.get(CategoryID)) throw new RequestError(400, "Choose an existing venue and category.");
        if (types.reduce((sum, type) => sum + type.QuantityTotal, 0) > location.Capacity) {
          throw new RequestError(400, "Ticket quantities exceed the venue capacity.");
        }
        const event = create.get(user.UserID, VenueID, CategoryID, title, description || null, date, time);
        const tickets = types.map(type => ({
          ...addType.get(event.EventID, type.Name, type.PriceCents, type.QuantityTotal), ...type
        }));
        db.exec("COMMIT");
        return { ...event, TicketTypes: tickets };
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }
  };
}
