import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { createAuth, readJson, RequestError } from "./auth.mjs";

import { createEventApproval } from "./event-approval.mjs";
import { createStudentApi } from "./student.mjs";

const databasePath = process.env.EVENTPASS_DB ??
  fileURLToPath(new URL("./eventpass.sqlite", import.meta.url));
const db = new DatabaseSync(databasePath);

db.exec("BEGIN IMMEDIATE");
try {
  db.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
  if (db.prepare("PRAGMA user_version").get().user_version === 0) {
    db.exec(readFileSync(new URL("./seed.sql", import.meta.url), "utf8"));
    db.exec("PRAGMA user_version = 1");
  }
  if (db.prepare("PRAGMA user_version").get().user_version === 1) {
    db.exec(readFileSync(new URL("./migrate-v2.sql", import.meta.url), "utf8"));
    db.exec("PRAGMA user_version = 2");
  }
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
}

const routes = new Map([
  ["/api/health", db.prepare("SELECT 1 AS ok")],
  ["/api/categories", db.prepare("SELECT * FROM Categories ORDER BY CategoryID")],
  ["/api/venues", db.prepare("SELECT * FROM Venues ORDER BY VenueID")],
  ["/api/events", db.prepare("SELECT * FROM Events WHERE Status = 'Active' ORDER BY EventID")],
  ["/api/tickettypes", db.prepare(`
    SELECT t.TicketTypeID, t.EventID, t.Name, t.PriceCents / 100.0 AS Price,
           t.QuantityTotal, t.QuantityTotal - (
             SELECT COUNT(*) FROM Tickets AS ticket
             JOIN Bookings AS booking ON booking.BookingID = ticket.BookingID
             WHERE ticket.TicketTypeID = t.TicketTypeID AND booking.Status = 'Confirmed'
           ) AS QuantityAvailable
    FROM TicketTypes AS t JOIN Events AS e ON e.EventID = t.EventID
    WHERE e.Status = 'Active'
    ORDER BY t.TicketTypeID
  `)]
]);

const auth = createAuth(db);
const student = createStudentApi(db, routes);
const customer = request => auth.authenticate(request, ["Customer"]).user;
const approval = createEventApproval(db);
const organizer = request => auth.authenticate(request, ["Organizer"]).user;
function admin(request) {
  auth.authenticate(request, ["Admin"]);
}
const authRoutes = new Map([
  ["/api/organizer/events", {
    GET: [200, request => approval.mine(organizer(request).UserID)],
    POST: [201, async request => approval.submit(organizer(request), await readJson(request))]
  }],
  ["/api/admin/events/pending", {
    GET: [200, request => {
      admin(request);
      return approval.pending();
    }]
  }],
  ["/api/student", { GET: [200, request => student.snapshot(customer(request))] }],
  ["/api/bookings", { POST: [201, async request => student.book(customer(request), await readJson(request))] }],
  ["/api/register", { POST: [201, async request => auth.register(await readJson(request))] }],
  ["/api/login", { POST: [200, async request => auth.login(await readJson(request))] }],
  ["/api/me", { GET: [200, request => auth.authenticate(request).user] }],
  ["/api/logout", { POST: [200, request => auth.logout(request)] }]
]);

function sendJson(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

const frontendTypes = { html: "text/html", js: "text/javascript", css: "text/css" };
function serveStudentPage(path, response) {
  const match = path.match(/^\/student\/((?:login|register|index|event|cart|checkout|booking|my-bookings)\.html|(?:js|css)\/[a-z-]+\.(?:js|css))$/);
  if (!match) return false;
  const file = match[1];
  try {
    const body = readFileSync(new URL("../frontend/" + file, import.meta.url));
    response.writeHead(200, { "Content-Type": frontendTypes[file.split(".").pop()] + "; charset=utf-8" });
    response.end(body);
  } catch (error) {
    if (error.code !== "ENOENT") console.error(error);
    sendJson(response, error.code === "ENOENT" ? 404 : 500, { message: "Page unavailable." });
  }
  return true;
}

const server = createServer(async (request, response) => {
  const path = request.url.split("?", 1)[0];
  if (request.method === "GET" && serveStudentPage(path, response)) return;
  const cancel = path.match(/^\/api\/bookings\/(\d+)\/cancel$/);
  const approvalPath = path.match(/^\/api\/admin\/events\/(\d+)\/approve$/);
  const handlers = cancel
    ? { POST: [200, req => student.cancel(customer(req), Number(cancel[1]))] }
    : approvalPath
      ? { POST: [200, req => {
        admin(req);
        return approval.approve(Number(approvalPath[1]));
      }] }
      : authRoutes.get(path);
  if (handlers) {
    response.setHeader("Cache-Control", "no-store");
    if (!Object.hasOwn(handlers, request.method)) {
      const allowed = Object.keys(handlers).join(", ");
      response.setHeader("Allow", allowed);
      sendJson(response, 405, { message: `Allowed methods: ${allowed}.` });
      return;
    }
    const [status, handler] = handlers[request.method];
    try {
      sendJson(response, status, await handler(request));
    } catch (error) {
      if (error instanceof RequestError) {
        sendJson(response, error.status, { message: error.message });
      } else {
        console.error(error);
        sendJson(response, 500, { message: "Database request failed." });
      }
    }
    return;
  }
  const statement = routes.get(path);
  if (!statement) {
    sendJson(response, 404, { message: "Endpoint not found." });
    return;
  }
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    sendJson(response, 405, { message: "Use GET for this endpoint." });
    return;
  }
  try {
    const rows = statement.all();
    sendJson(response, 200, path === "/api/health" ? { ok: rows[0].ok === 1 } : rows);
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { message: "Database request failed." });
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, "127.0.0.1", () => {
  console.log(`EventPass API listening at http://127.0.0.1:${server.address().port}`);
});
