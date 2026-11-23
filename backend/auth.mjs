import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const sessionLifetime = 8 * 60 * 60;
const userFields = "UserID, FirstName, LastName, Email, StudentID, Phone, Role";
const hashToken = token => createHash("sha256").update(token).digest("hex");
const timestamp = () => Math.floor(Date.now() / 1000);

export class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function readJson(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size <= 8192) chunks.push(chunk);
  }
  if (size > 8192) throw new RequestError(413, "Request body is too large.");
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw new RequestError(400, "Send a JSON object.");
  }
}

function field(body, key) {
  return typeof body[key] === "string" ? body[key].trim() : "";
}

export function createAuth(db) {
  const userByEmail = db.prepare(`SELECT ${userFields}, PasswordHash FROM Users WHERE Email = ?`);
  const insertUser = db.prepare(`
    INSERT INTO Users (FirstName, LastName, Email, StudentID, Phone, Role, PasswordHash)
    VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING ${userFields}
  `);
  const addSession = db.prepare("INSERT INTO Sessions VALUES (?, ?, ?)");
  const deleteExpired = db.prepare("DELETE FROM Sessions WHERE ExpiresAt <= ?");
  const findSession = db.prepare(`
    SELECT ${userFields} FROM Users
    WHERE UserID = (SELECT UserID FROM Sessions WHERE TokenHash = ? AND ExpiresAt > ?)
  `);
  const deleteSession = db.prepare("DELETE FROM Sessions WHERE TokenHash = ?");
  const dummySalt = randomBytes(16).toString("hex");
  const dummyHash = randomBytes(64);

  function register(body) {
    const firstName = field(body, "FirstName");
    const lastName = field(body, "LastName");
    const email = field(body, "Email").toLowerCase();
    const phone = field(body, "Phone");
    const role = field(body, "Role");
    const studentId = role === "Customer" ? field(body, "StudentID") : null;
    const password = body.Password;

    if (role !== "Customer" && role !== "Organizer") {
      throw new RequestError(400, "Choose a student or organizer account.");
    }
    if (!firstName || !lastName || firstName.length > 80 || lastName.length > 80 ||
        /[<>]/.test(firstName + lastName) || email.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        !/^[\d ().-]+$/.test(phone) || phone.replace(/\D/g, "").length !== 10 ||
        typeof password !== "string" || password.length < 8 || password.length > 128) {
      throw new RequestError(400, "Enter valid names, email, phone and an 8–128 character password.");
    }
    if (role === "Customer" && (!email.endsWith("@student.wpunj.edu") || !/^855\d{6}$/.test(studentId))) {
      throw new RequestError(400, "Enter your WPU student email and a 9-digit student ID starting with 855.");
    }

    const salt = randomBytes(16).toString("hex");
    const passwordHash = salt + ":" + scryptSync(password, salt, 64).toString("hex");
    try {
      return insertUser.get(firstName, lastName, email, studentId, phone, role, passwordHash);
    } catch (error) {
      if (error.errcode === 2067) throw new RequestError(409, "That email or student ID is already registered.");
      throw error;
    }
  }

  function login(body) {
    const email = field(body, "Email");
    const password = body.Password;
    const rejected = new RequestError(401, "Incorrect email or password.");
    if (!email || email.length > 254 || typeof password !== "string" || password.length > 128) throw rejected;

    const account = userByEmail.get(email);
    const stored = account?.PasswordHash?.split(":");
    const provided = scryptSync(password, stored?.[0] ?? dummySalt, 64);
    const correct = timingSafeEqual(provided, stored ? Buffer.from(stored[1], "hex") : dummyHash);
    if (!stored || !correct) throw rejected;

    const now = timestamp();
    const token = randomBytes(32).toString("hex");
    deleteExpired.run(now);
    addSession.run(hashToken(token), account.UserID, now + sessionLifetime);
    const { PasswordHash, ...user } = account;
    return { ...user, token };
  }

  function authenticate(request, allowedRoles) {
    const token = request.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/i)?.[1];
    const tokenHash = token ? hashToken(token) : null;
    const user = tokenHash && findSession.get(tokenHash, timestamp());
    if (!user) throw new RequestError(401, "Sign in to continue.");
    if (allowedRoles && !allowedRoles.includes(user.Role)) {
      throw new RequestError(403, "Your account cannot access this endpoint.");
    }
    return { user, tokenHash };
  }

  return {
    register,
    login,
    authenticate,
    logout(request) {
      deleteSession.run(authenticate(request).tokenHash);
      return { ok: true };
    }
  };
}
