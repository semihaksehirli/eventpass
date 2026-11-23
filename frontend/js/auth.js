// Keeps track of who is logged in (saved in the browser).

function setCurrentUser(user) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(user));
}

function getCurrentUser() {
  const saved = localStorage.getItem(SESSION_KEY);
  return saved ? JSON.parse(saved) : null;
}

// Send each role to its own starting page
function goHome(user) {
  const pages = { Admin: "admin.html", Organizer: "organizer.html" };
  window.location.href = (user && pages[user.Role]) || "index.html";
}

async function logout() {
  if (!USE_MOCK) {
    try { await request("POST", "/logout"); }
    catch (error) { console.error(error); }
  }
  localStorage.removeItem(SESSION_KEY);
  window.location.href = "login.html";
}

// Call on pages that need a logged-in user. Pass roles to limit access, e.g. requireLogin(["Admin"])
function requireLogin(roles) {
  const user = getCurrentUser();
  if (!user) {
    window.location.href = "login.html";
    return null;
  }
  if (roles && !roles.includes(user.Role)) {
    goHome(user);
    return null;
  }
  return user;
}

// Fills in the navbar links depending on login state
function renderNav() {
  const nav = document.getElementById("nav-links");
  if (!nav) return;
  const user = getCurrentUser();

  // Phone menu: a cart shortcut (students) + a ☰ button that opens the links
  const bar = nav.parentElement;
  if (!bar.querySelector(".menu-btn")) {
    const tools = document.createElement("div");
    tools.className = "mobile-tools";
    tools.innerHTML = (user && user.Role === "Customer"
      ? `<a href="cart.html" class="mobile-cart" aria-label="Cart">🛒<span class="cart-count"></span></a>` : "") +
      `<button class="menu-btn" aria-label="Menu" aria-expanded="false"><span></span><span></span><span></span></button>`;
    bar.insertBefore(tools, nav);
    tools.querySelector(".menu-btn").addEventListener("click", e => {
      const open = bar.classList.toggle("open");
      e.currentTarget.setAttribute("aria-expanded", open);
    });
  }

  if (user) {
    const roleLinks = {
      Customer: `<a href="index.html">Events</a>
                 <a href="my-bookings.html">My Bookings</a>
                 <a href="cart.html" class="cart-link">Cart <span id="cart-count" class="cart-count"></span></a>`,
      Organizer: `<a href="index.html">Events</a><a href="organizer.html">My Dashboard</a>`,
      Admin: `<a href="index.html">Events</a><a href="admin.html">Admin Dashboard</a>`
    };
    const roleName = user.Role === "Customer" ? "Student" : user.Role;
    nav.innerHTML = `
      ${roleLinks[user.Role] || ""}
      <span class="nav-user">Hi, <span id="nav-user-name"></span> (${roleName})</span>
      <a href="#" id="logout-link">Log out</a>`;
    document.getElementById("nav-user-name").textContent = user.FirstName;
    if (typeof updateCartCount === "function") updateCartCount();
    document.getElementById("logout-link").addEventListener("click", e => {
      e.preventDefault();
      logout();
    });
  } else {
    nav.innerHTML = `
      <a href="login.html">Log in</a>
      <a href="register.html" class="btn btn-small">Sign up</a>`;
  }
}

function showMessage(el, text, type) {
  el.textContent = text;
  el.className = "message " + type;
}

// Clear a field's error message as soon as the user types in it
document.addEventListener("input", e => {
  const errorEl = document.getElementById(e.target.id + "-error");
  if (errorEl) {
    errorEl.textContent = "";
    e.target.classList.remove("invalid");
  }
});

document.addEventListener("DOMContentLoaded", renderNav);
