# EventPass — Front End

Plain HTML, CSS and JavaScript. Open `login.html` in a browser (or use VS Code Live Server).
It runs on fake data saved in the browser until the back end is ready (see `js/api.js`).

## Test accounts

| Role | Email | Password |
| --- | --- | --- |
| Student | doej@student.wpunj.edu | jane1234 |
| Organizer | lopezm@wpunj.edu | staff123 |
| Admin | admin@wpunj.edu | admin123 |

## Proposal features → screens

| # | Feature | Screen(s) |
| --- | --- | --- |
| 1 | User registration and login | `register.html` (Student or Organizer), `login.html` |
| 2 | Event browsing and search | `index.html` — search, category, venue, date, price range, free only |
| 3 | Event details page | `event.html?id=…` — description, venue, date/time, ticket types with seats left |
| 4 | Ticket booking and checkout | `event.html` (add to cart) → `cart.html` → `checkout.html` (payment) → `booking.html` (e-tickets) |
| 5 | Booking history and cancellation | `my-bookings.html` (Upcoming / Past / Cancelled), cancel from there or `booking.html` |
| 6 | Organizer event management | `organizer.html` — event + ticket type CRUD, attendees & check-in, sales |
| 7 | Admin dashboard | `admin.html` — approve events, users, venues & categories, bookings, sales & attendance reports |

## Files

- `js/data.js` — fake data for every table (Users, Venues, Categories, Events, TicketTypes, Bookings, BookingItems, Payments, Tickets)
- `js/api.js` — every data call; switch `USE_MOCK` to `false` to use the real REST API
- `js/auth.js` — login state, navbar, role-based page access
- `js/helpers.js` — shared helpers (formatting, cart, sales numbers)
- `js/common.js` — shared dashboard code (pop-up forms, event/ticket CRUD, report table)
- One `.js` file per page: `browse.js`, `event.js`, `cart.js`, `checkout.js`, `booking.js`, `my-bookings.js`, `organizer.js`, `admin.js`

## Back-end endpoints the front end expects

`POST /register`, `POST /login`, `GET/POST/PUT/DELETE /{table}`, `POST /bookings`,
`POST /bookings/{id}/cancel`, `PUT /booking-items/{id}/check-in`.

## Switching to the real back end

1. Start the back end.
2. In `js/api.js` set `USE_MOCK = false` (and `API_BASE_URL` if it isn't on port 3000).
3. Open `login.html` with Live Server.

## Live site (with the back end)

Run `node backend/server.mjs` and open http://127.0.0.1:3000/student/login.html.
Pages opened under `/student/` use the real API; opening the files directly keeps the fake data.

| Screen | Connected to the API |
| --- | --- |
| Sign up / log in (student, organizer, admin) | ✅ |
| Browse, event details, free checkout, My Bookings, cancel | ✅ |
| Organizer: My Events, Create event (goes to admin as Pending) | ✅ |
| Admin: pending events + Approve | ✅ |
| Paid checkout, event photos, edit/cancel/delete events, ticket types, attendees & check-in, sales, admin users/venues/bookings/reports | ⏳ waiting on back-end endpoints (fake data only) |

To make an admin account: sign up as an organizer, then run
`node backend/promote-admin.mjs <email>` and log in again.
