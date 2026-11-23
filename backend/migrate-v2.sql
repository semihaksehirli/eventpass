CREATE TABLE Users (
  UserID INTEGER PRIMARY KEY,
  FirstName TEXT NOT NULL,
  LastName TEXT NOT NULL,
  Email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  StudentID TEXT UNIQUE,
  Phone TEXT,
  PasswordHash TEXT,
  Role TEXT NOT NULL CHECK (Role IN ('Customer', 'Organizer', 'Admin'))
) STRICT;

-- Retain the organizer references from the catalog. These placeholders cannot sign in.
INSERT INTO Users (UserID, FirstName, LastName, Email, Role)
SELECT DISTINCT OrganizerID, 'Catalog', 'Organizer', 'organizer-' || OrganizerID || '@example.invalid', 'Organizer'
FROM Events;

ALTER TABLE TicketTypes RENAME TO LegacyTicketTypes;
ALTER TABLE Events RENAME TO LegacyEvents;

CREATE TABLE Events (
  EventID INTEGER PRIMARY KEY,
  OrganizerID INTEGER NOT NULL REFERENCES Users (UserID),
  VenueID INTEGER NOT NULL REFERENCES Venues (VenueID),
  CategoryID INTEGER NOT NULL REFERENCES Categories (CategoryID),
  Title TEXT NOT NULL,
  Description TEXT,
  EventDate TEXT NOT NULL,
  StartTime TEXT NOT NULL,
  ImageURL TEXT,
  Status TEXT NOT NULL CHECK (Status IN ('Active', 'Pending', 'Cancelled'))
) STRICT;
INSERT INTO Events SELECT * FROM LegacyEvents;

CREATE TABLE TicketTypes (
  TicketTypeID INTEGER PRIMARY KEY,
  EventID INTEGER NOT NULL REFERENCES Events (EventID),
  Name TEXT NOT NULL,
  PriceCents INTEGER NOT NULL CHECK (PriceCents >= 0),
  QuantityTotal INTEGER NOT NULL CHECK (QuantityTotal > 0),
  UNIQUE (EventID, Name)
) STRICT;
INSERT INTO TicketTypes
SELECT TicketTypeID, EventID, Name, PriceCents, QuantityTotal FROM LegacyTicketTypes;

CREATE TABLE Bookings (
  BookingID INTEGER PRIMARY KEY,
  BookingDate TEXT NOT NULL,
  Status TEXT NOT NULL CHECK (Status IN ('Confirmed', 'Cancelled')),
  UserID INTEGER NOT NULL REFERENCES Users (UserID)
) STRICT;

CREATE TABLE Tickets (
  TicketCode TEXT PRIMARY KEY,
  CheckedIn INTEGER NOT NULL DEFAULT 0 CHECK (CheckedIn IN (0, 1)),
  BookingID INTEGER NOT NULL REFERENCES Bookings (BookingID),
  TicketTypeID INTEGER NOT NULL REFERENCES TicketTypes (TicketTypeID)
) STRICT;
CREATE INDEX Tickets_ByType ON Tickets (TicketTypeID);
CREATE INDEX Tickets_ByBooking ON Tickets (BookingID);
CREATE INDEX Bookings_ByUser ON Bookings (UserID);

-- Preserve seats already marked unavailable by the original demo seed.
INSERT INTO Users (FirstName, LastName, Email, Role)
SELECT 'Catalog', 'Sample Customer', 'catalog-customer@example.invalid', 'Customer'
WHERE EXISTS (SELECT 1 FROM LegacyTicketTypes WHERE QuantityAvailable < QuantityTotal);

INSERT INTO Bookings (BookingDate, Status, UserID)
SELECT '2026-11-04', 'Confirmed', UserID FROM Users WHERE Email = 'catalog-customer@example.invalid';

WITH RECURSIVE ReservedSeats (TicketTypeID, Seat, SeatCount) AS (
  SELECT TicketTypeID, 1, QuantityTotal - QuantityAvailable
  FROM LegacyTicketTypes WHERE QuantityAvailable < QuantityTotal
  UNION ALL
  SELECT TicketTypeID, Seat + 1, SeatCount FROM ReservedSeats WHERE Seat < SeatCount
)
INSERT INTO Tickets (TicketCode, BookingID, TicketTypeID)
SELECT 'EP-CATALOG-' || TicketTypeID || '-' || Seat, BookingID, TicketTypeID
FROM ReservedSeats CROSS JOIN Bookings;

DROP TABLE LegacyTicketTypes;
DROP TABLE LegacyEvents;

CREATE TABLE InCart (
  UserID INTEGER NOT NULL REFERENCES Users (UserID),
  TicketTypeID INTEGER NOT NULL REFERENCES TicketTypes (TicketTypeID),
  Quantity INTEGER NOT NULL CHECK (Quantity > 0),
  PRIMARY KEY (UserID, TicketTypeID)
) STRICT;

CREATE TABLE Sessions (
  TokenHash TEXT PRIMARY KEY,
  UserID INTEGER NOT NULL REFERENCES Users (UserID) ON DELETE CASCADE,
  ExpiresAt INTEGER NOT NULL
) STRICT;
