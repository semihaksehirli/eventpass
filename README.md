# EventPass: Event Ticket Booking System

A web app where William Paterson University students browse campus events, add tickets to a cart
and book them online. Organizers create and manage events; admins approve events and see sales
and attendance reports. Database Systems group project.

**Team:** Kshitij Kshitij · Millind Patel · Semih Aksehirli · Josh Choi

![Browse events](docs/screenshots/Desktop/03_browse.jpg)

## Project structure

```
eventpass/
├── frontend/          HTML/CSS/JS screens (runs on fake data until the back end is ready)
└── docs/screenshots/  every screen, desktop and phone
```

## Run the front end

Open `frontend/login.html` with VS Code's Live Server and log in as
`doej@student.wpunj.edu` / `jane1234` (student), `lopezm@wpunj.edu` / `staff123` (organizer)
or `admin@wpunj.edu` / `admin123` (admin).

See [`frontend/README.md`](frontend/README.md) for which screen covers each feature and
which endpoints the front end calls.

## How we work in this repo

1. Pull the latest code before you start: `git pull`
2. Make a branch for your work: `git checkout -b your-feature`
3. Commit often with clear messages
4. Push the branch and open a **Pull Request** into `main`

Questions about the front end? Contact Semih Aksehirli.

## Run the catalog API

With Node.js 24, run `node backend/server.mjs` from the repository root.
The server creates and seeds `backend/eventpass.sqlite` on the first run.
Set `EVENTPASS_DB` to use a different database file or `PORT` to change the port.

Open http://127.0.0.1:3000/api/events to see the demo events.
The read-only API also provides `/api/health`, `/api/categories`,
`/api/venues`, and `/api/tickettypes`. Events and ticket types are limited
to approved events. The frontend demo should keep `USE_MOCK = true`
while authentication, booking, and dashboard endpoints are in development.

## Test authentication

Restart the API to migrate an existing catalog database to schema version 2.
The migration preserves catalog rows and converts the original reserved demo
inventory into demo tickets. It creates the user, booking, ticket and cart
tables plus an internal session table. Placeholder catalog owners have no login.

- `POST /api/register` accepts `FirstName`, `LastName`, `Email`, `StudentID`, `Phone`, `Role` and `Password`. The allowed signup roles are `Customer` and `Organizer`.
- `POST /api/login` accepts `Email` and `Password` and returns the user profile and an eight-hour bearer token.
- `GET /api/me` returns the current profile with an `Authorization: Bearer <token>` header.
- `POST /api/logout` revokes the supplied token.

Keep the browser demo in mock mode until frontend integration. The API uses
the frontend's field names. The catalog seed remains a small demo fixture.

## Live student demo

Run `node backend/server.mjs` and open
[Student login](http://127.0.0.1:3000/student/login.html). Use the student
account registered against the API or sign up through this page. Open
**Winter Career Fair**, add a free ticket, and confirm checkout. The booking
and ticket code are saved to SQLite and appear in My Bookings after refresh.
You can cancel an upcoming booking and release its seats.

The cart is still stored in the browser. The live student demo supports free
bookings. The separate Live Server mock demo still includes the organizer and
admin screens.

## Organizer submission and admin approval API

Register separate organizer and admin test accounts as `Organizer` using
`POST /api/register`. From the repository root, promote only the intended
admin account with `node backend/promote-admin.mjs <email>`. Log in separately
with each account to get its bearer token. The promotion script uses the same
default database path as the server and respects `EVENTPASS_DB`.

| Method and endpoint | Role | Purpose |
| --- | --- | --- |
| `GET /api/organizer/events` | Organizer | List your own events |
| `POST /api/organizer/events` | Organizer | Submit an event and its ticket types as pending |
| `GET /api/admin/events/pending` | Admin | List submissions awaiting approval |
| `POST /api/admin/events/{id}/approve` | Admin | Approve a pending event |

For submission, send JSON such as:

```json
{
  "Title": "Campus Volunteer Fair",
  "Description": "Meet campus volunteer organizations.",
  "VenueID": 2,
  "CategoryID": 4,
  "EventDate": "2026-12-15",
  "StartTime": "14:00",
  "TicketTypes": [{ "Name": "Student", "PriceCents": 0, "QuantityTotal": 30 }]
}
```

The public catalog and student pages display the event and its ticket types
once approved. Organizer and admin dashboard screens still use mock data.
